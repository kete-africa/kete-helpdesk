import {
  MessageItem,
  MessageStream,
  type ConversationWords,
  type ShownMessage,
} from '@kete/conversation';
import { MessageField, Panel, type MessageFieldWords } from '@kete/design';
import { useCallback, useEffect, useState } from 'react';
import { fetchPerson, fetchTicketThread, sayInTicketThread } from '@/features/tickets/functions';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// A ticket's thread, beside the ticket (kete-core spec 141; Kete Enterprise spec 099): the same
// conversation as in « Fils » at the center, drawn by @kete/conversation, answered with the one
// composer. Without Kete Enterprise there is none, and Support works alone.

type Thread = NonNullable<Awaited<ReturnType<typeof fetchTicketThread>>>;

const hour = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );

function conversationWords(): ConversationWords {
  return {
    time: hour,
    day,
    someone: m.thread_someone(),
    agent: m.thread_agent(),
    kete: 'Kete',
    newMessages: m.thread_new(),
    jumpToNew: (count) => m.thread_jump({ count: String(count) }),
    older: m.thread_older(),
    typing: (names) => m.thread_typing({ names: names.join(', ') }),
    readBy: (readers) => m.thread_read_by({ who: readers.join(' · ') }),
    sent: m.thread_sent(),
    edited: m.thread_edited(),
    showOriginal: m.thread_show_original(),
    movedHere: m.thread_moved_here(),
    movedAway: m.thread_moved_away(),
    deleted: (name) => m.thread_deleted({ name }),
    imported: m.thread_imported(),
    onlyForYou: m.thread_only_for_you(),
    onlyForYouWhy: m.thread_only_for_you_why(),
    share: m.thread_share(),
    shared: m.thread_shared(),
    via: {
      whatsapp: m.thread_via_whatsapp(),
      mail: m.thread_via_mail(),
      telegram: m.thread_via_telegram(),
      form: m.thread_via_form(),
    },
    toClient: m.thread_to_client(),
    internal: m.thread_internal(),
    forAction: m.thread_for_action(),
    forInformation: m.thread_for_information(),
    reply: m.thread_reply(),
    react: (emoji) => m.thread_react({ emoji }),
    more: m.thread_more(),
    close: m.thread_close(),
    transcript: m.thread_transcript(),
    play: m.thread_play(),
    speed: m.thread_speed(),
    replyingTo: (name) => m.thread_replying({ name }),
    steps: m.thread_steps(),
    fold: m.thread_fold(),
    stop: m.thread_stop(),
    infos: m.thread_infos(),
    state: m.thread_state(),
    searchThread: m.thread_search(),
    notifications: m.thread_notifications(),
    notifyLevel: {
      all: m.thread_notify_all(),
      mentions: m.thread_notify_mentions(),
      none: m.thread_notify_none(),
    },
    notifyHint: m.thread_notify_hint(),
    categories: {
      pins: m.thread_cat_pins(),
      photos: m.thread_cat_photos(),
      documents: m.thread_cat_documents(),
      links: m.thread_cat_links(),
      voices: m.thread_cat_voices(),
      actions: m.thread_cat_actions(),
      decisions: m.thread_cat_decisions(),
      members: m.thread_cat_members(),
    },
    nothingHere: m.thread_nothing(),
    version: (n) => m.thread_version({ n: String(n) }),
    list: m.thread_list(),
    back: m.thread_back(),
    states: {
      needs: m.thread_needs(),
      working: m.thread_working(),
      finished: m.thread_finished(),
      idle: m.thread_idle(),
    },
    resolved: m.thread_resolved(),
    unread: (count) => m.thread_unread({ count: String(count) }),
  };
}

function fieldWords(): MessageFieldWords {
  return {
    field: m.thread_field(),
    placeholder: m.thread_placeholder(),
    send: m.thread_send(),
    stop: m.thread_stop(),
    add: m.thread_add(),
    attach: m.thread_attach(),
    mention: m.thread_mention(),
    cite: m.thread_cite(),
    emoji: m.thread_emoji(),
    moreEmoji: m.thread_more_emoji(),
    remove: m.thread_remove(),
    cancelReply: m.thread_cancel_reply(),
    record: m.thread_record(),
    recording: m.thread_recording(),
    cancelRecording: m.thread_cancel_recording(),
    sendRecording: m.thread_send_recording(),
    dictate: m.thread_dictate(),
  };
}

/** The ticket's thread: read every 15 seconds while the page is open; she answers in it. */
export function TicketThread({ ticketId }: { ticketId: string }) {
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [me, setMe] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const read = useCallback(
    () =>
      void fetchTicketThread({ data: { ticketId } })
        .then(setThread)
        .catch(() => setThread(null)),
    [ticketId],
  );
  useEffect(() => {
    read();
    void fetchPerson().then((person) => setMe(person?.userId ?? ''));
    const timer = setInterval(read, 15_000);
    return () => clearInterval(timer);
  }, [read]);
  if (thread === undefined) return null;
  const words = conversationWords();
  return (
    <Panel title={m.thread_title()}>
      {thread === null ? (
        <p className="text-body-sm text-fg-muted">{m.thread_none()}</p>
      ) : (
        <div className="grid gap-2">
          <a href={thread.href} className="w-fit text-body-sm font-semibold text-link">
            {m.thread_open_center()}
          </a>
          <div className="flex max-h-[460px] min-h-[160px] flex-col overflow-hidden rounded-control border border-line bg-bg">
            <MessageStream
              label={thread.thread.title}
              words={words}
              messages={thread.messages as unknown as ShownMessage[]}
              unreadFrom={thread.unreadFrom}
              older={thread.older}
              onOlder={() => window.open(thread.href, '_blank')}
              empty={m.thread_empty()}
              renderMessage={(message) => (
                <MessageItem
                  key={message.first}
                  message={message}
                  words={words}
                  me={{ kind: 'person', id: me }}
                  nameOf={(who) => thread.names[who.id] ?? ''}
                  fileHref={(id) => `${thread.href.split('/fils')[0]}/api/fils/fichiers/${id}`}
                />
              )}
            />
          </div>
          {thread.thread.state === 'open' && (
            <MessageField
              words={fieldWords()}
              draftKey={`ticket-${ticketId}`}
              onSend={async (text) => {
                setNote(null);
                const said = await sayInTicketThread({ data: { ticketId, text } });
                if (!said.ok) {
                  setNote(m.thread_failed({ reason: said.error ?? '' }));
                  return false;
                }
                read();
                return true;
              }}
              hint={note ?? m.thread_hint()}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
