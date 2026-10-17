import { commandsDelegationMigrationSql, commandsMigrationSql } from '@kete/commands';
import { draftsMigrationSql } from '@kete/drafts';
import { feedbackMigrationSql } from '@kete/feedback';
import { outboxMigrationSql } from '@kete/sdk';
import { settingsMigrationSql } from '@kete/settings';
import { billingMigrationSql } from '@/features/billing';
import { ticketOrganizationsMigrationSql, ticketsMigrationSql } from '@/features/tickets';

export interface MigrationContext {
  schema: string;
  appRole: string;
  ownerRole: string;
}

export interface Migration {
  name: string;
  sql(context: MigrationContext): string;
}

/**
 * The app's migrations, in order; never edit one that ran. Every table comes with its row-level
 * security in the same migration (constitution V).
 */
export const migrations: Migration[] = [
  {
    // The tables kete-core provides: command journal, drafts, event outbox, feedback.
    name: '0000_kete',
    sql: (context) =>
      [
        commandsMigrationSql(context),
        draftsMigrationSql(context),
        outboxMigrationSql(context),
        feedbackMigrationSql(context),
      ].join('\n'),
  },
  { name: '0001_tickets', sql: (context) => ticketsMigrationSql(context) },
  // The journal keeps the chain of agents behind each gesture (doctrine D-039).
  { name: '0002_kete_delegation', sql: (context) => commandsDelegationMigrationSql(context) },
  // The business events to Kete Enterprise, in their own outbox (kete-core spec 049).
  {
    name: '0003_kete_center_outbox',
    sql: (context) => outboxMigrationSql({ ...context, name: 'kete_center_outbox' }),
  },
  // Who pays for a ticket, and its interventions (spec 005).
  { name: '0004_billing', sql: (context) => billingMigrationSql(context) },
  // The organizations whose tickets the worker says to Kete Enterprise (spec 006).
  { name: '0005_ticket_organizations', sql: (context) => ticketOrganizationsMigrationSql(context) },
  // The app's settings and their journal: the currency of what is billed (spec 007).
  { name: '0006_kete_settings', sql: (context) => settingsMigrationSql(context) },
];
