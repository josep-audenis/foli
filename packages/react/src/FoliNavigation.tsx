import {
  type BookmarkInfo,
  type CommentMatch,
  commentAnchors,
  deleteBookmark,
  documentOutline,
  type Editor,
  type EditorState,
  type FindMatch,
  fieldCodesShown,
  findAll,
  findInComments,
  goTo,
  insertBookmark,
  listBookmarks,
  type NavigationRequest,
  nextMatch,
  type OutlineEntry,
  type ReplaceRefusal,
  type ReplaceReport,
  renameBookmark,
  replace,
  replaceAll,
  replaceInComments,
  type Transaction,
  trackState,
} from "@folijs/core";
import { StoryStep, wordContext } from "@folijs/core/internal";
import { keyName } from "@folijs/view";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useActiveEditor,
  useEditorOrContext,
  useEditorState,
  useIsomorphicLayoutEffect,
} from "./editor.js";

export interface FoliNavigationProps {
  /** Default: the editor of the nearest `FoliEditorProvider`. */
  editor?: Editor | undefined;
  /** No replacing, and no changing bookmarks. */
  readOnly?: boolean | undefined;
}

type PanelMode = "find" | "replace" | "goTo";

/** What each refusal is called in the panel's report. */
const REFUSALS: Record<ReplaceRefusal, string> = {
  locked: "locked content",
  control: "a content control",
  field: "across a field's edge",
  "field-code": "a field code",
  deleted: "deleted text",
  stale: "changed text",
  refused: "could not be changed",
};

const WHERE: Record<string, string> = {
  header: "header",
  footer: "footer",
  footnote: "footnote",
  endnote: "endnote",
};

/** The text selected now, in the story open or the body. */
function activeState(body: Editor): { story: string | null; state: EditorState } {
  const open = body.storyView?.open?.id ?? null;
  const story = open ? body.story(open) : null;
  return story ? { story: open, state: story.state } : { story: null, state: body.state };
}

function isSelected(body: Editor, match: FindMatch): boolean {
  const { story, state } = activeState(body);
  const { from, to } = state.selection;
  return story === match.story && from === match.from && to === match.to;
}

/**
 * `match` where `transactions` leave it, or null when they changed it or its story: until the next
 * search the marks follow the text and Enter goes where they are.
 */
function mapMatch(
  match: FindMatch,
  transactions: readonly Transaction[],
  stories: ReadonlySet<string>,
): FindMatch | null {
  if (match.story !== null) return stories.has(match.story) ? null : match;
  let { from, to } = match;
  for (const tr of transactions)
    for (const map of tr.mapping.maps) {
      // Anything a step changes inside it (an edit of the same length too) ends it as a match.
      let touched = false;
      map.forEach((start, end) => {
        if (start < to && end > from) touched = true;
      });
      if (touched) return null;
      from = map.map(from, 1);
      to = map.map(to, -1);
    }
  return from === match.from ? match : { ...match, from, to };
}

/** What the document shows has changed: another search is due. */
function searchKey(state: EditorState): readonly unknown[] {
  return [
    state.doc,
    wordContext(state)?.envelope.stories,
    wordContext(state)?.envelope.controls,
    wordContext(state)?.envelope.comments,
    trackState(state)?.view,
    fieldCodesShown(state),
  ];
}

function reportText({ replaced, refused }: ReplaceReport): string {
  const done = `Replaced ${replaced}.`;
  if (!refused.length) return done;
  const reasons = [...new Set(refused.map((r) => REFUSALS[r.reason]))].join(", ");
  return `${done} ${refused.length} left as they are: ${reasons}.`;
}

/**
 * Word's navigation for an editor: the find and replace panel (Ctrl+F, Ctrl+H, with Go to on
 * Ctrl+G; F3 and Shift+F3 go to the next and previous match), the bookmarks dialog (Ctrl+Shift+F5)
 * and the outline. The keys are taken only while the focus is in the document or in these panels:
 * elsewhere on the page Ctrl+F stays the browser's. The toolbar's Navigate menu opens them too.
 */
export function FoliNavigation({ editor: given, readOnly = false }: FoliNavigationProps) {
  const body = useEditorOrContext(given, "FoliNavigation");
  const active = useActiveEditor(body);
  const [panel, setPanel] = useState<PanelMode | null>(null);
  const [request, setRequest] = useState(0);
  const [bookmarks, setBookmarks] = useState(false);
  const [outline, setOutline] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  /** Where the focus goes back to. */
  const restore = useRef<HTMLElement | null>(null);
  const live = useRef({ query, matchCase, wholeWord, panel });
  live.current = { query, matchCase, wholeWord, panel };

  const remember = useCallback(() => {
    const element = typeof document === "undefined" ? null : document.activeElement;
    // Inside the panels the focus already has a place to go back to.
    if (
      element instanceof HTMLElement &&
      element !== document.body &&
      !element.closest("[data-foli-navigation]")
    )
      restore.current = element;
  }, []);
  const giveBack = useCallback(() => {
    const element = restore.current;
    restore.current = null;
    if (element?.isConnected && !element.closest("[aria-readonly=true]")) element.focus();
    else body.storyView?.focus();
  }, [body]);

  useEffect(() => {
    const step = (backward: boolean) => {
      const current = live.current;
      if (!current.query) return false;
      const target = nextMatch(body, findAll(body, current.query, current), backward);
      if (target) goTo(body, target, { focus: true });
      return true;
    };
    const handler = (asked: NavigationRequest): boolean => {
      if (asked === "next" || asked === "previous") {
        // With the panel open its own buttons' logic runs through the keys it handles.
        if (step(asked === "previous")) return true;
        remember();
        setPanel("find");
        setRequest((n) => n + 1);
        return true;
      }
      remember();
      if (asked === "bookmarks") {
        setBookmarks(true);
        setRequest((n) => n + 1);
      } else if (asked === "outline") setOutline((open) => !open);
      else {
        // What is selected is what to find, as in Word.
        const { state } = activeState(body);
        const { from, to, empty } = state.selection;
        const text = empty ? "" : state.doc.textBetween(from, to, "\n");
        if (text && text.length < 256 && !text.includes("\n")) setQuery(text);
        setPanel(asked === "replace" && readOnly ? "find" : asked);
        setRequest((n) => n + 1);
      }
      return true;
    };
    body.navigation = handler;
    return () => {
      if (body.navigation === handler) body.navigation = null;
    };
  }, [body, readOnly, remember]);

  return (
    <div className="foli-navigation" data-foli-navigation="">
      {panel && (
        <FindPanel
          body={body}
          mode={panel}
          request={request}
          readOnly={readOnly}
          query={query}
          matchCase={matchCase}
          wholeWord={wholeWord}
          onQuery={setQuery}
          onMatchCase={setMatchCase}
          onWholeWord={setWholeWord}
          onMode={setPanel}
          onBookmarks={() => {
            setBookmarks(true);
            setRequest((n) => n + 1);
          }}
          onClose={() => {
            setPanel(null);
            giveBack();
          }}
        />
      )}
      {bookmarks && (
        <BookmarksDialog
          body={body}
          active={active}
          readOnly={readOnly}
          request={request}
          onClose={(moved) => {
            setBookmarks(false);
            if (!moved) giveBack();
            else restore.current = null;
          }}
        />
      )}
      {outline && (
        <OutlinePanel
          body={body}
          onClose={() => {
            setOutline(false);
            giveBack();
          }}
        />
      )}
    </div>
  );
}

interface FindPanelProps {
  body: Editor;
  mode: PanelMode;
  request: number;
  readOnly: boolean;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  onQuery(query: string): void;
  onMatchCase(on: boolean): void;
  onWholeWord(on: boolean): void;
  onMode(mode: PanelMode): void;
  onBookmarks(): void;
  onClose(): void;
}

interface Found {
  matches: readonly FindMatch[];
  current: FindMatch | null;
  /** Whether the view goes to `current`: not when the document changed under the search. */
  scroll: boolean;
  /** The document changed since `matches` were found: only `current` is known to be right. */
  stale?: boolean;
}

/** How long typing in the document pauses before the matches are looked for again, in ms. */
const RESEARCH_DELAY = 300;

/** The find, replace and go to panel: not modal, the document stays usable beside it. */
function FindPanel({
  body,
  mode: asked,
  request,
  readOnly,
  query,
  matchCase,
  wholeWord,
  onQuery,
  onMatchCase,
  onWholeWord,
  onMode,
  onBookmarks,
  onClose,
}: FindPanelProps) {
  // Replace is not offered once the editor turns read-only under an open panel.
  const mode = readOnly && asked === "replace" ? "find" : asked;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState("");
  const [found, setFound] = useState<Found>({ matches: [], current: null, scroll: false });
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const options = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);
  // Comments are searched apart, as Word's "Main document" leaves them out (19.2).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for the document
  const inComments = useMemo(
    () => findInComments(body, query, options),
    [body, query, options, version],
  );

  const [focusing, setFocusing] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each request focuses the panel again
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [request, focusing]);

  // Searched again when what the document shows changes, once typing there pauses.
  useEffect(() => {
    let key = searchKey(body.state);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = body.subscribe((state, transactions) => {
      const next = searchKey(state);
      if (transactions.some((tr) => tr.docChanged)) {
        const stories = new Set<string>();
        for (const tr of transactions)
          for (const step of tr.steps) if (step instanceof StoryStep) stories.add(step.id);
        // Only the current match follows the text at once: the rest waits for the search, and
        // meanwhile is not marked where it no longer is.
        setFound((found) => {
          if (!found.matches.length) return found;
          const current = found.current && mapMatch(found.current, transactions, stories);
          if (found.stale && current === found.current) return found;
          return { ...found, current, scroll: false, stale: true };
        });
      }
      if (next.some((value, i) => value !== key[i])) {
        clearTimeout(timer);
        timer = setTimeout(() => setVersion((n) => n + 1), RESEARCH_DELAY);
      }
      key = next;
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [body]);

  // A new search goes to the match at or after the selection.
  useEffect(() => {
    const matches = findAll(body, query, options);
    setFound({
      matches,
      current: matches.find((m) => isSelected(body, m)) ?? nextMatch(body, matches),
      scroll: true,
    });
  }, [body, query, options]);
  // The document changed: the same search again, the current match kept if it is still there,
  // and the view left where the person typing has it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for the document
  useEffect(() => {
    if (!version) return;
    const matches = findAll(body, query, options);
    setFound(({ current }) => ({
      matches,
      current:
        (current &&
          matches.find(
            (m) => m.story === current.story && m.from === current.from && m.to === current.to,
          )) ??
        null,
      scroll: false,
    }));
  }, [version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search says nothing of the last
  useEffect(() => setMessage(""), [query, options]);

  // With the count shown, in the same frame.
  useIsomorphicLayoutEffect(() => {
    const { stale, ...shown } = found;
    const matches = stale ? (shown.current ? [shown.current] : []) : shown.matches;
    body.storyView?.showMatches(query ? { query, ...options, ...shown, matches } : null);
  }, [body, query, options, found]);
  useEffect(() => () => body.storyView?.showMatches(null), [body]);

  const show = (matches: readonly FindMatch[], current: FindMatch | null) => {
    setFound({ matches, current, scroll: true });
    if (current && !goTo(body, current))
      setMessage(`This match is in a ${storyName(body, current)} no page shows.`);
    else setMessage("");
  };
  /** The matches as the document is now, and the current one among them. */
  const now = (): Found => {
    if (!found.stale) return found;
    const matches = findAll(body, query, options);
    const was = found.current;
    const current =
      (was &&
        matches.find((m) => m.story === was.story && m.from === was.from && m.to === was.to)) ??
      null;
    return { matches, current, scroll: false };
  };
  const step = (backward: boolean) => {
    const { matches, current } = now();
    const first = !backward && current && !isSelected(body, current);
    show(matches, first ? current : nextMatch(body, matches, backward));
  };
  const replaceCurrent = () => {
    const { matches, current } = now();
    if (!current) return;
    if (!isSelected(body, current)) {
      show(matches, current);
      return;
    }
    const report = replace(body, current, replacement, options);
    const fresh = findAll(body, query, options);
    show(fresh, nextMatch(body, fresh));
    setMessage(reportText(report));
  };
  const all = () => {
    const report = replaceAll(body, query, replacement, options);
    // What is left at once, as after Replace: not the replaced text for a moment.
    const fresh = findAll(body, query, options);
    setFound({ matches: fresh, current: nextMatch(body, fresh), scroll: false });
    setMessage(reportText(report));
  };

  /** Selects the text comment `id` (or the comment it replies to) is on. */
  const toComment = (id: number) => {
    const byId = new Map((wordContext(body.state)?.envelope.comments ?? []).map((c) => [c.id, c]));
    let root = byId.get(id);
    const seen = new Set<number>();
    while (root?.parent !== undefined && byId.has(root.parent) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.parent);
    }
    const a = root && commentAnchors(body.state.doc).get(root.id);
    const from = a?.start ?? a?.reference;
    const to = a?.end ?? a?.reference;
    if (from === undefined || to === undefined || !goTo(body, { story: null, from, to }))
      setMessage("This comment is on no text the pages show.");
    else setMessage("");
  };
  const allInComments = () => {
    const { replaced, refused } = replaceInComments(body, query, replacement, options);
    setMessage(
      `Replaced ${replaced} in comments.${refused ? ` ${refused} left as they are.` : ""}`,
    );
    // The list goes once nothing is left to find: the focus stays in the panel.
    replaceInput.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const name = keyName(event.nativeEvent);
    const modes: Record<string, PanelMode> = { "Mod-f": "find", "Mod-g": "goTo" };
    if (!readOnly) modes["Mod-h"] = "replace";
    const next = Object.hasOwn(modes, name) ? modes[name] : undefined;
    if (name === "Escape") onClose();
    else if (next) {
      onMode(next);
      setFocusing((n) => n + 1);
    } else if (name === "F3" || name === "Shift-F3") step(name !== "F3");
    else if (name === "Shift-Enter" && (event.target as Element).tagName === "INPUT") step(true);
    else if (name === "Mod-Shift-F5") onBookmarks();
    else return;
    event.preventDefault();
  };

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = tabs.findIndex(([value]) => value === mode);
    const [next] = tabs[(at + step + tabs.length) % tabs.length] as [PanelMode, string];
    onMode(next);
    (event.currentTarget.querySelector(`[id$="-tab-${next}"]`) as HTMLElement | null)?.focus();
  };

  const position = found.current ? found.matches.indexOf(found.current) + 1 : 0;
  const status =
    message ||
    (!query
      ? ""
      : found.matches.length && !position
        ? `${found.matches.length} found`
        : found.matches.length
          ? `${position} of ${found.matches.length}${
              found.current?.story ? `, in a ${storyName(body, found.current)}` : ""
            }`
          : "No results");
  // Comments are counted in the status too: it is what a screen reader hears.
  const statusText =
    query && !message && inComments.length ? `${status}, ${inComments.length} in comments` : status;
  const tabs: [PanelMode, string][] = [
    ["find", "Find"],
    ...(readOnly ? [] : ([["replace", "Replace"]] as [PanelMode, string][])),
    ["goTo", "Go to"],
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the dialog's own keys, as the toolbar's
    <div
      role="dialog"
      aria-label="Find and replace"
      className="foli-link-dialog foli-find-panel"
      onKeyDown={onKeyDown}
    >
      <div className="foli-find-modes">
        <div role="tablist" aria-label="What to do" onKeyDown={onTabKey}>
          {tabs.map(([value, label]) => (
            <button
              key={value}
              id={`${id}-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={mode === value}
              aria-controls={`${id}-panel`}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => onMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${mode}`}>
        {mode === "goTo" ? (
          <GoToForm body={body} first={input} onDone={onClose} />
        ) : (
          <form
            noValidate
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              step(false);
            }}
          >
            <label htmlFor={`${id}-find`}>Find what</label>
            <input
              ref={input}
              id={`${id}-find`}
              type="text"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
            {mode === "replace" && (
              <>
                <label htmlFor={`${id}-with`}>Replace with</label>
                <input
                  ref={replaceInput}
                  id={`${id}-with`}
                  type="text"
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
              </>
            )}
            <label className="foli-find-option">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(event) => onMatchCase(event.target.checked)}
              />
              Match case
            </label>
            <label className="foli-find-option">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(event) => onWholeWord(event.target.checked)}
              />
              Whole words
            </label>
            <button type="button" disabled={!found.matches.length} onClick={() => step(true)}>
              Previous
            </button>
            <button type="submit" disabled={!found.matches.length}>
              Next
            </button>
            {mode === "replace" && (
              <>
                <button type="button" disabled={!found.current} onClick={replaceCurrent}>
                  Replace
                </button>
                <button type="button" disabled={!found.matches.length} onClick={all}>
                  Replace all
                </button>
              </>
            )}
            <p role="status" className="foli-find-status">
              {statusText}
            </p>
            {query && inComments.length > 0 && (
              <CommentMatches
                body={body}
                matches={inComments}
                onGo={toComment}
                onReplace={mode === "replace" ? allInComments : null}
              />
            )}
          </form>
        )}
      </div>
    </div>
  );
}

/** The comments a search found text in: one button each, going to the text it is on. */
function CommentMatches({
  body,
  matches,
  onGo,
  onReplace,
}: {
  body: Editor;
  matches: readonly CommentMatch[];
  onGo(id: number): void;
  onReplace: (() => void) | null;
}) {
  const comments = wordContext(body.state)?.envelope.comments ?? [];
  const ids = [...new Set(matches.map((m) => m.comment))];
  return (
    <section className="foli-find-comments" aria-label="Found in comments">
      <p aria-hidden="true">{`${matches.length} in comments`}</p>
      <ul>
        {ids.map((id) => {
          const comment = comments.find((c) => c.id === id);
          const text = (comment?.content ?? [])
            .map((b) => (b.content ?? []).map((n) => n.text ?? "").join(""))
            .join(" ");
          return (
            <li key={id}>
              <button type="button" onClick={() => onGo(id)}>
                {`${comment?.author ?? ""}: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}`}
              </button>
            </li>
          );
        })}
      </ul>
      {onReplace && (
        <button type="button" onClick={onReplace}>
          Replace in comments
        </button>
      )}
    </section>
  );
}

const storyName = (body: Editor, match: FindMatch) =>
  WHERE[wordContext(body.state)?.stories.get(match.story ?? "")?.kind ?? ""] ?? "story";

/** Go to a page, a bookmark or a heading. */
function GoToForm({
  body,
  first,
  onDone,
}: {
  body: Editor;
  first: React.RefObject<HTMLInputElement | null>;
  onDone(): void;
}) {
  const id = useId();
  const [kind, setKind] = useState<"page" | "bookmark" | "heading">("page");
  const [page, setPage] = useState("1");
  const [failed, setFailed] = useState(false);
  const [marks] = useState(() => listBookmarks(body));
  const [headings] = useState(() => documentOutline(body.state));
  const [picked, setPicked] = useState("0");
  const go = (event: FormEvent) => {
    event.preventDefault();
    const view = body.storyView;
    const at = Number(picked);
    const mark = marks[at];
    const heading = headings[at];
    const done =
      kind === "page"
        ? !!view?.goToPage(Number(page), { focus: true })
        : kind === "bookmark"
          ? !!mark && goTo(body, mark, { focus: true })
          : !!heading &&
            goTo(
              body,
              { story: null, from: heading.pos + 1, to: heading.pos + 1 },
              { focus: true },
            );
    if (done) onDone();
    else setFailed(true);
  };
  const options =
    kind === "bookmark" ? marks.map((m) => m.name) : headings.map((entry) => entry.text);
  return (
    <form noValidate onSubmit={go}>
      <label htmlFor={`${id}-kind`}>Go to what</label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as typeof kind);
          setPicked("0");
          setFailed(false);
        }}
      >
        <option value="page">Page</option>
        <option value="bookmark">Bookmark</option>
        <option value="heading">Heading</option>
      </select>
      {kind === "page" ? (
        <>
          <label htmlFor={`${id}-page`}>Page number</label>
          <input
            ref={first}
            id={`${id}-page`}
            type="text"
            inputMode="numeric"
            value={page}
            onChange={(event) => {
              setPage(event.target.value);
              setFailed(false);
            }}
          />
        </>
      ) : (
        <>
          <label htmlFor={`${id}-target`}>{kind === "bookmark" ? "Bookmark" : "Heading"}</label>
          <select
            id={`${id}-target`}
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          >
            {options.map((label, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two headings can read the same
              <option key={i} value={String(i)}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="submit">Go to</button>
      {failed && (
        <p className="foli-link-error" role="alert">
          There is no such place.
        </p>
      )}
    </form>
  );
}

const BOOKMARK_ERRORS: Record<string, string> = {
  "invalid-name":
    "A bookmark's name starts with a letter and has only letters, digits and underscores (40 at most).",
  "no-place": "A bookmark cannot go here.",
  missing: "That bookmark is gone.",
  exists: "Another bookmark has that name.",
  refused: "The content here cannot change.",
};

/** The bookmarks: add (a name used moves it, as in Word), go to, rename, delete. */
function BookmarksDialog({
  body,
  active,
  readOnly,
  request,
  onClose,
}: {
  body: Editor;
  active: Editor;
  readOnly: boolean;
  request: number;
  onClose(moved: boolean): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [list, setList] = useState<BookmarkInfo[]>(() => listBookmarks(body));
  const [picked, setPicked] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: each request focuses it again
  useEffect(() => {
    input.current?.focus();
  }, [request]);
  // The list follows the document: the dialog is not modal, bookmarks change under it.
  useEffect(() => {
    setList(listBookmarks(body, { hidden }));
    let { doc } = body.state;
    let context = wordContext(body.state);
    return body.subscribe((state) => {
      if (state.doc === doc && wordContext(state) === context) return;
      doc = state.doc;
      context = wordContext(state);
      setList(listBookmarks(body, { hidden }));
    });
  }, [body, hidden]);
  const refresh = () => setList(listBookmarks(body, { hidden }));
  const outcome = (result: { ok: boolean; reason?: string }) => {
    setError(result.ok ? "" : (BOOKMARK_ERRORS[result.reason ?? ""] ?? ""));
    refresh();
    return result.ok;
  };
  const chosen = list.find((b) => b.name === picked) ?? null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape, as in the toolbar's dialogs
    <div
      role="dialog"
      aria-label="Bookmarks"
      className="foli-link-dialog foli-find-panel foli-bookmarks"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!readOnly && outcome(insertBookmark(active, name.trim()))) {
            setPicked(name.trim());
            setName("");
          }
        }}
      >
        <label htmlFor={`${id}-name`}>Bookmark name</label>
        <input
          ref={input}
          id={`${id}-name`}
          type="text"
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
        <label htmlFor={`${id}-list`}>Bookmarks</label>
        <select
          id={`${id}-list`}
          size={6}
          value={picked}
          onChange={(event) => {
            setPicked(event.target.value);
            setName(event.target.value);
            setError("");
          }}
        >
          {list.map((bookmark) => (
            <option key={bookmark.name} value={bookmark.name}>
              {bookmark.name}
              {bookmark.text ? `: ${bookmark.text.slice(0, 40)}` : ""}
            </option>
          ))}
        </select>
        <label className="foli-find-option">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />
          Hidden bookmarks
        </label>
        {!readOnly && <button type="submit">Add</button>}
        <button
          type="button"
          disabled={!chosen}
          onClick={() => {
            if (chosen && goTo(body, chosen, { focus: true })) onClose(true);
            else setError("No page shows that bookmark.");
          }}
        >
          Go to
        </button>
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => {
                if (chosen && outcome(renameBookmark(body, chosen.name, name.trim())))
                  setPicked(name.trim());
              }}
            >
              Rename
            </button>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => {
                if (!chosen) return;
                // Refused (locked content): the bookmark stays picked, and the dialog says so.
                if (outcome({ ok: deleteBookmark(body, chosen.name), reason: "refused" })) {
                  setPicked("");
                  setName("");
                }
              }}
            >
              Delete
            </button>
          </>
        )}
        <button type="button" onClick={() => onClose(false)}>
          Close
        </button>
        {error && (
          <p className="foli-link-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

/** The headings of the document; a press goes there. Up and Down move between them. */
function OutlinePanel({ body, onClose }: { body: Editor; onClose(): void }) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const list = useRef<HTMLOListElement>(null);
  const caret = useEditorState((state) => state.selection.from, { editor: body });
  useEffect(() => {
    const read = () => setEntries(documentOutline(body.state, body.storyView?.fieldLayout ?? null));
    read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let doc = body.state.doc;
    const unsubscribe = body.subscribe((state) => {
      if (state.doc === doc) return;
      doc = state.doc;
      clearTimeout(timer);
      // After the pages have settled: the entries show their numbers.
      timer = setTimeout(read, 150);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [body]);
  let current = -1;
  entries.forEach((entry, i) => {
    if (entry.pos < caret) current = i;
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (event.key === "Escape") onClose();
    else if (step) {
      const buttons = [...(list.current?.querySelectorAll("button") ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[Math.max(0, Math.min(at + step, buttons.length - 1))]?.focus();
    } else return;
    event.preventDefault();
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the panel's keys
    <nav aria-label="Document outline" className="foli-outline" onKeyDown={onKeyDown}>
      <div className="foli-outline-head">
        <h2>Outline</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {entries.length ? (
        <ol ref={list}>
          {entries.map((entry, i) => (
            <li key={entry.pos} style={{ paddingInlineStart: `${(entry.level - 1) * 12}px` }}>
              <button
                type="button"
                aria-current={i === current ? "location" : undefined}
                onClick={() =>
                  goTo(
                    body,
                    { story: null, from: entry.pos + 1, to: entry.pos + 1 },
                    { focus: true },
                  )
                }
              >
                <span>
                  {entry.number ? `${entry.number} ` : ""}
                  {entry.text}
                </span>
                {entry.page && <span className="foli-outline-page">{entry.page}</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>No headings.</p>
      )}
    </nav>
  );
}
