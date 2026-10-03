import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/**
 * Who may do what with tickets. Checked on the server for every surface: a screen, the MCP
 * endpoint, an agent acting for a person. The roles are the defaults; once the organization
 * manages Support's rights in Kete Enterprise, its grants decide (kete-core spec 049).
 */
export const ticketPermissions = definePermissions([
  {
    name: 'tickets:read',
    label: words(m.perm_tickets_read),
    description: words(m.perm_tickets_read_body),
    roles: ['owner', 'admin', 'member'],
  },
  {
    name: 'tickets:write',
    label: words(m.perm_tickets_write),
    description: words(m.perm_tickets_write_body),
    roles: ['owner', 'admin', 'member'],
  },
  {
    name: 'tickets:manage',
    label: words(m.perm_tickets_manage),
    description: words(m.perm_tickets_manage_body),
    roles: ['owner', 'admin'],
  },
]);
