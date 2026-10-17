import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import type { ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { DESIGN } from '@/platform/app';
import { settingsOf } from '@/platform/settings';
import appCss from '@/styles/app.css?url';

/**
 * The mode she chose (kete-core specs 041 and 115), read before the page is drawn: no flash. Her
 * preferences come from the Compte Kete and follow her in every app; reading them also keeps her
 * organization's settings for its commands — the currency of what is billed (spec 007).
 */
const readTheme = createServerFn({ method: 'GET' }).handler(async () => {
  const settings = await settingsOf(getRequest()).catch(() => null);
  if (!settings || settings.from('kete.theme') === 'kete') return null;
  return settings.value<'dark' | 'light' | 'auto'>('kete.theme');
});

export const Route = createRootRoute({
  loader: () => readTheme(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: m.app_name() },
      { name: 'description', content: m.meta_description() },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  const theme = Route.useLoaderData();
  return (
    <html lang={getLocale()} data-design={DESIGN} {...(theme ? { 'data-theme': theme } : {})}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
