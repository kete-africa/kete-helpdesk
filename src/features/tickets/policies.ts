import type { Role } from '@/platform/rights';

/**
 * Who may do what with tickets, by organization role. Checked on the server for every surface: a
 * screen, the MCP endpoint, an agent acting for a person. Queues and indicators are the owners'.
 */
export const ticketPermissions: Record<Role, string[]> = {
  owner: ['tickets:read', 'tickets:write', 'tickets:manage'],
  admin: ['tickets:read', 'tickets:write', 'tickets:manage'],
  member: ['tickets:read', 'tickets:write'],
};
