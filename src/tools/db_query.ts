import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { SSHManager } from "../core/SSHManager.js";
import { isReadOnlyMode, isCommandDenied } from "../utils/security.js";
import { logger } from "../utils/logger.js";

const SQL_KEYWORDS_DENY = [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
    /\bTRUNCATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bREPLACE\b/i,
    /\bLOAD\b/i,
    /\bIMPORT\b/i,
    /\bINTO\s+OUTFILE\b/i,
    /\bINTO\s+DUMPFILE\b/i,
    /\bEXEC\b/i,
    /\bEXECUTE\b/i,
    /\bCALL\b/i,
    /\bRENAME\b/i,
    /\bLOCK\b/i,
    /\bUNLOCK\b/i,
    /\bSET\b/i,
    /\bFLUSH\b/i,
    /\bKILL\b/i,
    /\bSHUTDOWN\b/i,
];

const MONGO_DENY = [
    /\bdeleteOne\b/i,
    /\bdeleteMany\b/i,
    /\binsertOne\b/i,
    /\binsertMany\b/i,
    /\bupdateOne\b/i,
    /\bupdateMany\b/i,
    /\breplaceOne\b/i,
    /\bdrop\b/i,
    /\bremove\b/i,
    /\bcreateCollection\b/i,
    /\bcreateIndex\b/i,
    /\brenameCollection\b/i,
    /\bcollMod\b/i,
];

export const dbQuerySchema = z.object({
    session_id: z.string().min(1),
    type: z.enum(["mysql", "postgresql", "mongodb"]).describe("Database type"),
    database: z.string().min(1).describe("Database name"),
    query: z.string().min(1).max(5000).describe("Read-only query (SELECT, SHOW, EXPLAIN, find, aggregate)"),
    db_user: z.string().min(1).optional().describe("Database username (defaults to session user)"),
    db_password: z.string().min(1).optional().describe("Database password"),
    db_host: z.string().min(1).optional().describe("Database host on the remote side (default: 127.0.0.1)"),
    db_port: z.number().int().min(1).max(65535).optional().describe("Database port"),
    collection: z.string().min(1).optional().describe("MongoDB collection name (required for find/aggregate queries)"),
    timeout_ms: z.number().min(1000).max(60000).default(15000).describe("Query timeout in ms"),
});

export const dbQueryTool = {
    name: "db_query",
    description:
        "Execute a read-only database query on a remote host via SSH exec channel. Supports MySQL, PostgreSQL, and MongoDB. Enforces SELECT-only (or find/aggregate for Mongo). Returns structured JSON rows.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: { type: "string", description: "Session ID returned by connect" },
            type: { type: "string", description: "Database type", enum: ["mysql", "postgresql", "mongodb"] },
            database: { type: "string", description: "Database name" },
            query: { type: "string", description: "Read-only query (SELECT, SHOW, EXPLAIN, find, aggregate)" },
            db_user: { type: "string", description: "Database username (defaults to session user)" },
            db_password: { type: "string", description: "Database password" },
            db_host: { type: "string", description: "Database host on remote (default: 127.0.0.1)" },
            db_port: { type: "number", description: "Database port" },
            collection: { type: "string", description: "MongoDB collection (for find/aggregate queries)" },
            timeout_ms: { type: "number", description: "Query timeout in ms (default: 15000)", default: 15000 },
        },
        required: ["session_id", "type", "database", "query"],
    },
};

function q(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function isReadOnlyQuery(query: string, type: string): string | null {
    const trimmed = query.trim();

    if (type === "mysql" || type === "postgresql") {
        for (const pattern of SQL_KEYWORDS_DENY) {
            if (pattern.test(trimmed)) {
                return `SQL keyword blocked: ${trimmed.match(pattern)![0].toUpperCase()}`;
            }
        }
        const upper = trimmed.toUpperCase();
        if (
            !upper.startsWith("SELECT") &&
            !upper.startsWith("SHOW") &&
            !upper.startsWith("EXPLAIN") &&
            !upper.startsWith("DESCRIBE") &&
            !upper.startsWith("DESC ") &&
            !upper.startsWith("USE ")
        ) {
            return "Only SELECT, SHOW, EXPLAIN, DESCRIBE, and USE queries are allowed";
        }
    } else if (type === "mongodb") {
        for (const pattern of MONGO_DENY) {
            if (pattern.test(trimmed)) {
                return `MongoDB method blocked: ${trimmed.match(pattern)![0]}`;
            }
        }
        const lower = trimmed.toLowerCase();
        if (
            !lower.startsWith("db.") &&
            !lower.startsWith("show ") &&
            !lower.startsWith("rs.") &&
            !lower.startsWith("sh.")
        ) {
            return "MongoDB queries must start with db., show, rs., or sh.";
        }
    }

    return null;
}

function parseTabularOutput(stdout: string): Record<string, string>[] {
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const headerMatch = lines[0];
    if (headerMatch.includes("\t")) {
        const headers = lines.shift()!.split("\t");
        return lines.map((line) => {
            const cols = line.split("\t");
            const row: Record<string, string> = {};
            headers.forEach((h, i) => {
                row[h] = cols[i] || "";
            });
            return row;
        });
    }

    return [{ result: stdout }];
}

function parseMongoOutput(stdout: string): unknown[] {
    try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
    } catch {
        return [{ raw: stdout.slice(0, 10000) }];
    }
}

export async function handleDbQuery(args: unknown, sessionManager: SessionManager, sshManager: SSHManager) {
    const parsed = dbQuerySchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
        };
    }

    const { session_id, type, database, query, db_user, db_password, db_host, db_port, collection, timeout_ms } =
        parsed.data;
    const session = sessionManager.get(session_id);

    if (!session) {
        return {
            content: [{ type: "text" as const, text: `Error: Session '${session_id}' not found` }],
            isError: true,
        };
    }
    if (!sshManager.isAlive(session.ssh)) {
        return {
            content: [{ type: "text" as const, text: `Error: SSH connection dead for session '${session_id}'` }],
            isError: true,
        };
    }

    if (isReadOnlyMode(session.host)) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Host '${session.host}' is in read-only mode. DB query is disabled.`,
                },
            ],
            isError: true,
        };
    }

    const denyReason = isReadOnlyQuery(query, type);
    if (denyReason) {
        return {
            content: [{ type: "text" as const, text: `Error: Query rejected: ${denyReason}` }],
            isError: true,
        };
    }

    const host = db_host || "127.0.0.1";
    const port = db_port || (type === "mysql" ? 3306 : type === "postgresql" ? 5432 : 27017);
    const user = db_user || session.host.split(".")[0] || "root";

    let cmd: string;

    if (type === "mysql") {
        const passArg = db_password ? `-p${q(db_password)}` : "";
        cmd = `mysql -h ${q(host)} -P ${port} -u ${q(user)} ${passArg} -D ${q(database)} --batch --skip-column-names --default-character-set=utf8mb4 -e ${q(query)} 2>&1`;
    } else if (type === "postgresql") {
        const passEnv = db_password ? `PGPASSWORD=${q(db_password)} ` : "";
        cmd = `${passEnv}psql -h ${q(host)} -p ${port} -U ${q(user)} -d ${q(database)} -A -t --no-align -c ${q(query)} 2>&1`;
    } else {
        const collArg = collection ? `.${collection}` : "";
        cmd = `mongosh --host ${q(host)} --port ${port} --quiet --eval "printjson(JSON.stringify(${query.replace(/"/g, '\\"')}))" ${q(database)} 2>&1 || mongo --host ${q(host)} --port ${port} --quiet --eval "printjson(JSON.stringify(${query.replace(/"/g, '\\"')}))" ${q(database)} 2>&1`;
    }

    try {
        const result = await sshManager.exec(session.ssh, cmd, timeout_ms);

        if (result.code !== 0 && !result.stdout.trim()) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error: Query failed (exit ${result.code}): ${result.stderr || "unknown error"}`,
                    },
                ],
                isError: true,
            };
        }

        let rows: unknown;
        if (type === "mongodb") {
            rows = parseMongoOutput(result.stdout);
        } else {
            rows = parseTabularOutput(result.stdout);
        }

        const rowCount = Array.isArray(rows) ? rows.length : 1;

        logger.info({ sessionId: session_id, type, database, rows: rowCount }, "DB query executed");

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            type,
                            database,
                            query: query.length > 200 ? query.slice(0, 200) + "..." : query,
                            row_count: rowCount,
                            rows,
                            stderr: result.stderr ? result.stderr.slice(0, 500) : undefined,
                            exit_code: result.code,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    } catch (err) {
        logger.error({ sessionId: session_id, type, database, error: (err as Error).message }, "DB query failed");
        return {
            content: [{ type: "text" as const, text: `Error: DB query failed: ${(err as Error).message}` }],
            isError: true,
        };
    }
}
