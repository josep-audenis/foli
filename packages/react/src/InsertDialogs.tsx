/**
 * Word's Insert tab dialogs (Phase 35), opened by the toolbar as its other built-in dialogs:
 * each inserts at the selection it opened on, in one undo step.
 */

import {
  type Command,
  type Editor,
  formatDatePicture,
  insertDate,
  insertSymbol,
  insertText,
} from "@folijs/core";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type ToolbarMessage, useT } from "./messages.js";
import { Field, Tabs } from "./WordDialogs.js";

// ---------- Insert ▸ Symbol (35.1) ----------

/** A symbol as Word's recent list keeps it: its text and the font it was inserted in. @internal */
export interface RecentSymbol {
  readonly text: string;
  /** Null: the text's own font (Word's "(normal text)"). */
  readonly font: string | null;
}

/** Word's recent symbols before any is inserted (Word 16's, in its order). */
const DEFAULT_RECENT = [..."€£¥©®™±≠≤≥÷×∞µαβπΩ∑☺"].map((text) => ({ text, font: null }));
/** How many Word's menu keeps. */
const RECENT_COUNT = 20;
let recent: readonly RecentSymbol[] = DEFAULT_RECENT;

/**
 * The symbols the Symbol menu offers: the last inserted first, as Word's. Kept for the page's
 * life, shared by every toolbar on it.
 * shortcut: not kept across visits (Word keeps them in the user's settings); store them when an
 * app asks.
 * @internal
 */
export const recentSymbols = (): readonly RecentSymbol[] => recent;

/** Inserts a symbol (`insertSymbol`), then puts it first in the recent list. @internal */
export const symbolCommand =
  (symbol: RecentSymbol): Command =>
  (state, dispatch) => {
    const done = insertSymbol(symbol.text, symbol.font)(state, dispatch);
    if (done && dispatch)
      recent = [
        symbol,
        ...recent.filter((s) => s.text !== symbol.text || s.font !== symbol.font),
      ].slice(0, RECENT_COUNT);
    return done;
  };

let dialogInsert = false;
/** Whether the Symbol dialog is inserting (the toolbar keeps it open over that). @internal */
export const insertingSymbol = () => dialogInsert;

/** The Unicode blocks the Subset box offers, as Word's names them, with their ranges. */
const SUBSETS = [
  { name: "Basic Latin", from: 0x20, to: 0x7e },
  { name: "Latin-1 Supplement", from: 0xa0, to: 0xff },
  { name: "Latin Extended-A", from: 0x100, to: 0x17f },
  { name: "Latin Extended-B", from: 0x180, to: 0x24f },
  { name: "IPA Extensions", from: 0x250, to: 0x2af },
  { name: "Spacing Modifier Letters", from: 0x2b0, to: 0x2ff },
  { name: "Greek and Coptic", from: 0x370, to: 0x3ff },
  { name: "Cyrillic", from: 0x400, to: 0x4ff },
  { name: "Hebrew", from: 0x590, to: 0x5ff },
  { name: "Arabic", from: 0x600, to: 0x6ff },
  { name: "General Punctuation", from: 0x2000, to: 0x206f },
  { name: "Superscripts and Subscripts", from: 0x2070, to: 0x209f },
  { name: "Currency Symbols", from: 0x20a0, to: 0x20cf },
  { name: "Letterlike Symbols", from: 0x2100, to: 0x214f },
  { name: "Number Forms", from: 0x2150, to: 0x218f },
  { name: "Arrows", from: 0x2190, to: 0x21ff },
  { name: "Mathematical Operators", from: 0x2200, to: 0x22ff },
  { name: "Miscellaneous Technical", from: 0x2300, to: 0x23ff },
  { name: "Enclosed Alphanumerics", from: 0x2460, to: 0x24ff },
  { name: "Box Drawing", from: 0x2500, to: 0x257f },
  { name: "Block Elements", from: 0x2580, to: 0x259f },
  { name: "Geometric Shapes", from: 0x25a0, to: 0x25ff },
  { name: "Miscellaneous Symbols", from: 0x2600, to: 0x26ff },
  { name: "Dingbats", from: 0x2700, to: 0x27bf },
] as const;

/** What a grid does not show: unassigned code points, controls, surrogates, private use, marks. */
const UNSHOWN = /[\p{Cn}\p{Cc}\p{Cs}\p{Co}\p{Mn}\p{Me}]/u;

const subsetChars = (subset: { from: number; to: number }) => {
  const out: string[] = [];
  for (let code = subset.from; code <= subset.to; code++) {
    const char = String.fromCodePoint(code);
    if (!UNSHOWN.test(char)) out.push(char);
  }
  return out;
};

const subsetOf = (code: number) =>
  SUBSETS.findIndex((subset) => code >= subset.from && code <= subset.to);

const hex = (char: string) =>
  (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");

const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
/** Word's key names, Windows's; Cmd and Option on Apple platforms (as the keymap reads them). */
const keyText = (keys: string) =>
  IS_MAC ? keys.replace(/Ctrl/g, "Cmd").replace(/Alt/g, "Option") : keys;

/**
 * Word's Special Characters, in its order, with the keys Foli types them on (the base keymap's;
 * none where the key is left to the browser: Ctrl+Num - and Ctrl+- zoom out).
 */
const SPECIAL_CHARACTERS = [
  { char: "—", name: "Em Dash", keys: "Alt+Ctrl+Num -" },
  { char: "–", name: "En Dash", keys: "" },
  { char: "‑", name: "Nonbreaking Hyphen", keys: "Ctrl+Shift+_" },
  { char: "­", name: "Optional Hyphen", keys: "" },
  { char: " ", name: "Em Space", keys: "" },
  { char: " ", name: "En Space", keys: "" },
  { char: " ", name: "1/4 Em Space", keys: "" },
  { char: " ", name: "Nonbreaking Space", keys: "Ctrl+Shift+Space" },
  { char: "©", name: "Copyright", keys: "Alt+Ctrl+C" },
  { char: "®", name: "Registered", keys: "Alt+Ctrl+R" },
  { char: "™", name: "Trademark", keys: "Alt+Ctrl+T" },
  { char: "§", name: "Section", keys: "" },
  { char: "¶", name: "Paragraph", keys: "" },
  { char: "…", name: "Ellipsis", keys: "Alt+Ctrl+." },
  { char: "‘", name: "Single Opening Quote", keys: "" },
  { char: "’", name: "Single Closing Quote", keys: "" },
  { char: "“", name: "Double Opening Quote", keys: "" },
  { char: "”", name: "Double Closing Quote", keys: "" },
  { char: "‌", name: "No-Width Optional Break", keys: "" },
  { char: "‍", name: "No-Width Non Break", keys: "" },
] as const;

/** Characters per row of the grid (the arrow keys move by it up and down). */
const GRID_COLUMNS = 16;

/**
 * Word's Symbol dialog: Symbols (a font, a Unicode subset, its characters in that font, the
 * recently used ones and the character's code) and Special Characters (Word's list with their
 * keys). Insert puts the chosen one at the selection (`insertSymbol`) and keeps the dialog open,
 * as Word's does; Close (Escape) ends it.
 * @internal
 */
export function SymbolDialog({
  editor,
  fonts,
  onClose,
}: {
  editor: Editor;
  fonts: readonly string[];
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [tab, setTab] = useState("symbols");
  const [font, setFont] = useState("");
  const [subset, setSubset] = useState(0);
  const chars = subsetChars(SUBSETS[subset] as (typeof SUBSETS)[number]);
  const [chosen, setChosen] = useState<string>(chars[0] as string);
  const [code, setCode] = useState(hex(chars[0] as string));
  const [special, setSpecial] = useState(0);
  const [inserted, setInserted] = useState(false);
  const cells = useRef<(HTMLDivElement | null)[]>([]);
  const fontBox = useRef<HTMLSelectElement>(null);
  const specials = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => fontBox.current?.focus(), []);

  const choose = (char: string, focus = false) => {
    setChosen(char);
    setCode(hex(char));
    if (!focus) return;
    const at = subsetChars(SUBSETS[subset] as (typeof SUBSETS)[number]).indexOf(char);
    cells.current[at]?.focus();
  };
  const insert = (symbol: { text: string; font: string | null }) => {
    dialogInsert = true;
    try {
      if (editor.run(symbolCommand(symbol))) setInserted(true);
    } finally {
      dialogInsert = false;
    }
  };
  const insertChosen = () =>
    tab === "symbols"
      ? insert({ text: chosen, font: font || null })
      : insert({ text: (SPECIAL_CHARACTERS[special] as { char: string }).char, font: null });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    insertChosen();
  };

  const onGridKey = (event: KeyboardEvent) => {
    const at = chars.indexOf(chosen);
    const last = chars.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, at + 1),
      ArrowLeft: Math.max(0, at - 1),
      ArrowDown: Math.min(last, at + GRID_COLUMNS),
      ArrowUp: Math.max(0, at - GRID_COLUMNS),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      choose(chars[next] as string, true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      insert({ text: chosen, font: font || null });
    }
  };
  const onSpecialKey = (event: KeyboardEvent) => {
    const last = SPECIAL_CHARACTERS.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, special + 1),
      ArrowUp: Math.max(0, special - 1),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setSpecial(next);
      specials.current[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      insertChosen();
    }
  };

  const fontStyle = font ? { fontFamily: `"${font}"` } : undefined;
  const at = Math.max(0, chars.indexOf(chosen));
  const symbols = (
    <>
      <Field id={`${id}-font`} label={t("Font")}>
        <select
          ref={fontBox}
          id={`${id}-font`}
          value={font}
          onChange={(event) => setFont(event.target.value)}
        >
          <option value="">{t("(normal text)")}</option>
          {fonts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-subset`} label={t("Subset")}>
        <select
          id={`${id}-subset`}
          value={subset}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSubset(next);
            choose(subsetChars(SUBSETS[next] as (typeof SUBSETS)[number])[0] as string);
          }}
        >
          {SUBSETS.map((s, i) => (
            <option key={s.name} value={i}>
              {t(s.name)}
            </option>
          ))}
        </select>
      </Field>
      <div
        role="listbox"
        aria-label={t("Symbols")}
        className="foli-symbol-grid"
        style={{ ...fontStyle, gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)` }}
        onKeyDown={onGridKey}
      >
        {chars.map((char, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox takes the keys (arrows, Enter).
          <div
            key={char}
            ref={(element) => {
              cells.current[i] = element;
            }}
            role="option"
            aria-selected={i === at}
            aria-label={`${char} U+${hex(char)}`}
            tabIndex={i === at ? 0 : -1}
            className="foli-symbol-cell"
            onClick={() => choose(char)}
            onDoubleClick={() => insert({ text: char, font: font || null })}
          >
            {char}
          </div>
        ))}
      </div>
      <fieldset className="foli-dialog-section foli-symbol-recent">
        <legend>{t("Recently used symbols")}</legend>
        {recentSymbols().map((symbol) => (
          <button
            key={`${symbol.font ?? ""}/${symbol.text}`}
            type="button"
            className="foli-symbol-cell"
            aria-label={`${symbol.text} U+${hex(symbol.text)}${symbol.font ? ` ${symbol.font}` : ""}`}
            title={symbol.font ?? undefined}
            style={symbol.font ? { fontFamily: `"${symbol.font}"` } : undefined}
            onClick={() => {
              const i = subsetOf(symbol.text.codePointAt(0) ?? 0);
              setFont(symbol.font ?? "");
              if (i >= 0) setSubset(i);
              setChosen(symbol.text);
              setCode(hex(symbol.text));
            }}
            onDoubleClick={() => insert(symbol)}
          >
            {symbol.text}
          </button>
        ))}
      </fieldset>
      <Field id={`${id}-code`} label={t("Character code (Unicode, hex)")}>
        <input
          id={`${id}-code`}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={code}
          onChange={(event) => {
            const value = event.target.value.trim();
            setCode(value);
            const number = /^[0-9a-f]{1,6}$/i.test(value) ? Number.parseInt(value, 16) : -1;
            const i = subsetOf(number);
            if (i < 0) return;
            const char = String.fromCodePoint(number);
            if (UNSHOWN.test(char)) return;
            setSubset(i);
            setChosen(char);
          }}
        />
      </Field>
    </>
  );
  const specialList = (
    <div
      role="listbox"
      aria-label={t("Special characters")}
      className="foli-special-list"
      onKeyDown={onSpecialKey}
    >
      {SPECIAL_CHARACTERS.map((c, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox takes the keys (arrows, Enter).
        <div
          key={c.name}
          ref={(element) => {
            specials.current[i] = element;
          }}
          role="option"
          aria-selected={i === special}
          tabIndex={i === special ? 0 : -1}
          className="foli-special-row"
          onClick={() => setSpecial(i)}
          onDoubleClick={() => insert({ text: c.char, font: null })}
        >
          <span className="foli-special-char" aria-hidden="true">
            {c.char.trim() ? c.char : " "}
          </span>
          <span>{t(c.name)}</span>
          <span className="foli-special-keys">{c.keys ? keyText(c.keys) : ""}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div
      role="dialog"
      aria-label={t("Symbol")}
      className="foli-link-dialog foli-word-dialog foli-symbol-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(inserted);
      }}
    >
      <form onSubmit={submit} noValidate>
        <Tabs
          id={id}
          selected={tab}
          onSelect={setTab}
          tabs={[
            { key: "symbols", label: t("Symbols"), content: symbols },
            { key: "special", label: t("Special Characters"), content: specialList },
          ]}
        />
        <div className="foli-dialog-buttons">
          <button type="submit">{t("Insert")}</button>
          <button type="button" onClick={() => onClose(inserted)}>
            {t("Close")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Insert ▸ Date & Time (35.2) ----------

/** Word 16's Date and Time formats for English (United States), in its order. */
const US_FORMATS = [
  "M/d/yyyy",
  "dddd, MMMM d, yyyy",
  "MMMM d, yyyy",
  "M/d/yy",
  "yyyy-MM-dd",
  "d-MMM-yy",
  "M.d.yyyy",
  "MMM. d, yy",
  "d MMMM yyyy",
  "MMMM yy",
  "MMM-yy",
  "M/d/yyyy h:mm AM/PM",
  "M/d/yyyy h:mm:ss AM/PM",
  "h:mm AM/PM",
  "h:mm:ss AM/PM",
  "HH:mm",
  "HH:mm:ss",
];

/** The languages the box offers (tags and Word's names). */
const DATE_LANGUAGES: readonly (readonly [string, string])[] = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["es-ES", "Spanish (Spain)"],
  ["ca-ES", "Catalan"],
  ["fr-FR", "French (France)"],
  ["de-DE", "German (Germany)"],
  ["it-IT", "Italian (Italy)"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["nl-NL", "Dutch (Netherlands)"],
];

/** What the other languages' formats are made from: the language's own (CLDR's, by `Intl`). */
const DATE_STYLES: readonly Intl.DateTimeFormatOptions[] = [
  { year: "numeric", month: "2-digit", day: "2-digit" },
  { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  { year: "numeric", month: "long", day: "numeric" },
  { year: "2-digit", month: "2-digit", day: "2-digit" },
  { year: "numeric", month: "short", day: "numeric" },
  { year: "numeric", month: "long" },
  { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
  {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
  { hour: "2-digit", minute: "2-digit" },
  { hour: "2-digit", minute: "2-digit", second: "2-digit" },
];

/** A day whose parts tell padding apart: 5 January 2026, 05:04:03. */
const PROBE = new Date(2026, 0, 5, 5, 4, 3);

/** A language's way of writing `options` as a Word date picture (`\@`). */
function pictureOf(locale: string, options: Intl.DateTimeFormatOptions): string {
  const format = new Intl.DateTimeFormat(locale, options);
  const twelve = format.resolvedOptions().hourCycle?.startsWith("h1") ?? false;
  return format
    .formatToParts(PROBE)
    .map(({ type, value }) => {
      const padded = value.startsWith("0");
      switch (type) {
        case "year":
          return value.length === 2 ? "yy" : "yyyy";
        case "month": {
          if (/^\d+$/.test(value)) return padded ? "MM" : "M";
          // A genitive written with the month ("de gener" in Catalan): its words kept before it.
          const name = new Intl.DateTimeFormat(locale, { month: options.month }).format(PROBE);
          const at = value.toLowerCase().lastIndexOf(name.toLowerCase());
          const lead = at > 0 ? `'${value.slice(0, at).replace(/'/g, "")}'` : "";
          return lead + (options.month === "long" ? "MMMM" : "MMM");
        }
        case "day":
          return padded ? "dd" : "d";
        case "weekday":
          return options.weekday === "long" ? "dddd" : "ddd";
        case "hour":
          return twelve ? (padded ? "hh" : "h") : padded ? "HH" : "H";
        case "minute":
          return "mm";
        case "second":
          return "ss";
        case "dayPeriod":
          return "AM/PM";
        default:
          // Letters are quoted (Word's `'…'`); a period after a short month stays (`MMM.`).
          return /\p{L}/u.test(value) ? `'${value.replace(/'/g, "")}'` : value;
      }
    })
    .join("");
}

/** The formats the dialog offers for `locale`: Word's own for English (United States). */
function dateFormats(locale: string): readonly string[] {
  if (locale === "en-US") return US_FORMATS;
  return [...new Set([...DATE_STYLES.map((o) => pictureOf(locale, o)), "yyyy-MM-dd"])];
}

/** The box's language at first: the browser's, where offered (Word's: the editing language). */
const defaultLanguage = () => {
  const wanted = typeof navigator === "undefined" ? "en-US" : navigator.language;
  const tags = DATE_LANGUAGES.map(([tag]) => tag as string);
  return (
    tags.find((tag) => tag.toLowerCase() === wanted.toLowerCase()) ??
    tags.find((tag) => tag.split("-")[0] === wanted.split("-")[0]) ??
    "en-US"
  );
};

/**
 * Word's Date and Time dialog: the language's formats shown for now, Update automatically (a
 * `DATE` field in that picture, `insertDate`) or the text itself. OK inserts it in one undo step.
 * @internal
 */
export function DateTimeDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: (applied: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  const [now] = useState(() => new Date());
  const [language, setLanguage] = useState(defaultLanguage);
  const formats = dateFormats(language);
  const [chosen, setChosen] = useState(0);
  const [field, setField] = useState(false);
  const options = useRef<(HTMLDivElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => options.current[0]?.focus(), []);
  const picture = formats[Math.min(chosen, formats.length - 1)] as string;
  const apply = (event?: FormEvent) => {
    event?.preventDefault();
    onClose(
      editor.run(
        field
          ? insertDate(picture, { locale: language })
          : insertText(formatDatePicture(now, picture, language)),
      ),
    );
  };
  const onListKey = (event: KeyboardEvent) => {
    const last = formats.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, chosen + 1),
      ArrowUp: Math.max(0, chosen - 1),
      Home: 0,
      End: last,
    };
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
      return;
    }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setChosen(next);
    options.current[next]?.focus();
  };
  return (
    <div
      role="dialog"
      aria-label={t("Date and Time")}
      className="foli-link-dialog foli-word-dialog foli-date-time-dialog"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose(false);
      }}
    >
      <form onSubmit={apply} noValidate>
        <div className="foli-dialog-panel">
          <div
            ref={list}
            role="listbox"
            aria-label={t("Available formats")}
            className="foli-special-list"
            onKeyDown={onListKey}
          >
            {formats.map((format, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox takes the keys (arrows, Enter).
              <div
                key={format}
                ref={(element) => {
                  options.current[i] = element;
                }}
                role="option"
                aria-selected={i === chosen}
                tabIndex={i === chosen ? 0 : -1}
                className="foli-special-row foli-date-format"
                title={format}
                onClick={() => setChosen(i)}
                onDoubleClick={() => apply()}
              >
                {formatDatePicture(now, format, language)}
              </div>
            ))}
          </div>
          <Field id={`${id}-language`} label={t("Language")}>
            <select
              id={`${id}-language`}
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value);
                setChosen(0);
              }}
            >
              {DATE_LANGUAGES.map(([tag, name]) => (
                <option key={tag} value={tag}>
                  {t(name as ToolbarMessage)}
                </option>
              ))}
            </select>
          </Field>
          <div className="foli-setup-field foli-setup-check">
            <input
              id={`${id}-update`}
              type="checkbox"
              checked={field}
              onChange={(event) => setField(event.target.checked)}
            />
            <label htmlFor={`${id}-update`}>{t("Update automatically")}</label>
          </div>
        </div>
        <div className="foli-dialog-buttons">
          <button type="submit">{t("OK")}</button>
          <button type="button" onClick={() => onClose(false)}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
