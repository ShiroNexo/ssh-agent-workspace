import { listHostAliases } from "../utils/sshConfig.js";

export const listHostsTool = {
    name: "list_hosts",
    description:
        "List all available SSH host aliases from ~/.ssh/config. Only these aliases can be used with the connect tool.",
    inputSchema: {
        type: "object" as const,
        properties: {},
    },
};

export async function handleListHosts() {
    const hosts = listHostAliases();
    return {
        content: [{ type: "text" as const, text: JSON.stringify({ hosts }, null, 2) }],
    };
}
