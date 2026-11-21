import { rejectAllChanges, trackedChanges } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { openSession, type Session } from "./index.js";
import { corpus } from "./testing/corpus.js";

const open = async (name = "03-offer-letter-template") =>
  openSession((await corpus(name)).document, { author: "Agent" });
const lines = (session: Session) => {
  const result = session.read();
  if (!result.ok) throw new Error(result.message);
  return result.text.split("\n");
};

describe("controls", () => {
  it("lists the body's content controls with their values and where they are", async () => {
    const session = await open();
    // Asked before any read: the handles are still the document's, in its order.
    const controls = session.controls();
    expect(controls.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        name: "offer_date",
        tag: "offer_date",
        title: "Offer date",
        kind: "date",
        value: null,
        empty: true,
        readOnly: false,
        block: "b2",
      },
      {
        name: "position",
        tag: "position",
        title: "Position",
        kind: "dropDown",
        value: null,
        empty: true,
        items: ["Data Engineer", "Senior Data Engineer", "Engineering Manager"],
        readOnly: false,
        block: "b5",
      },
      {
        name: "salary",
        tag: "salary",
        title: "Salary",
        kind: "text",
        value: null,
        empty: true,
        readOnly: false,
        block: "b6",
      },
      {
        name: "remote",
        tag: "remote",
        title: "Remote",
        kind: "checkbox",
        value: false,
        empty: false,
        readOnly: false,
        block: "b8",
      },
      {
        name: "benefits",
        tag: "benefits",
        title: "Benefits",
        kind: "richText",
        value: "Private health insurance; 25 days' annual leave; pension contribution of 5%.",
        empty: false,
        readOnly: false,
        block: "b10",
      },
    ]);
    expect(new Set(controls.map((c) => c.id)).size).toBe(5);
    // The same handles a read gives those blocks.
    const read = session.read();
    expect(read.ok && read.blocks.find((b) => b.handle === "b2")?.text).toBe(
      "Date: [empty: Offer date]",
    );
    expect((await open("01-mutual-nda")).controls()).toEqual([]);
  });
});

describe("fillControl", () => {
  it("fills each kind of control as a tracked change", async () => {
    const session = await open();
    const original = lines(session);
    const date = session.fillControl("offer_date", "2026-12-01");
    expect(date).toMatchObject({
      ok: true,
      controls: [{ name: "offer_date", value: "2026-12-01", empty: false }],
    });
    expect(date.ok && date.text).toMatch(/Normal, changed: Date: 1 December 2026$/);
    expect(session.fillControl("Position", "Senior Data Engineer")).toMatchObject({
      ok: true,
      controls: [{ value: "Senior Data Engineer" }],
    });
    expect(session.fillControl("SALARY", "72,000")).toMatchObject({ ok: true });
    expect(session.fillControl("remote", true)).toMatchObject({
      ok: true,
      controls: [{ value: true }],
    });
    expect(session.fillControl("benefits", "Health insurance and 30 days' leave.")).toMatchObject({
      ok: true,
    });
    const now = lines(session).join("\n");
    expect(now).toContain("Date: 1 December 2026");
    expect(now).toContain("Position: Senior Data Engineer");
    expect(now).toContain("Annual salary (EUR): 72,000");
    expect(now).toContain("☒ Remote working eligible");
    expect(now).toContain("Health insurance and 30 days' leave.");
    expect(now).not.toContain("[empty:");

    const changes = trackedChanges(session.editor.state.doc);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.author === "Agent")).toBe(true);
    session.editor.run(rejectAllChanges("Agent"));
    expect(lines(session)).toEqual(original);
    expect(session.controls().map((c) => c.value)).toEqual([
      null,
      null,
      null,
      false,
      "Private health insurance; 25 days' annual leave; pension contribution of 5%.",
    ]);
  });

  it("empties a control with null, bringing its placeholder back", async () => {
    const session = await open();
    session.fillControl("salary", "72,000");
    expect(session.fillControl("salary", null)).toMatchObject({
      ok: true,
      controls: [{ value: null, empty: true }],
    });
    expect(lines(session)[5]).toContain("Annual salary (EUR): [empty: Salary]");
  });

  it("refuses with what would work", async () => {
    const session = await open();
    const unknown = session.fillControl("candidate", "x");
    expect(unknown).toMatchObject({ ok: false, code: "unknown-control" });
    expect(!unknown.ok && unknown.message).toContain(
      "offer_date, position, salary, remote, benefits",
    );
    const item = session.fillControl("position", "Chief Engineer");
    expect(item).toMatchObject({ ok: false, code: "invalid" });
    expect(!item.ok && item.message).toContain('"Senior Data Engineer"');
    // A date control takes a day, or any text typed, as in Word; not a day that does not exist.
    expect(session.fillControl("offer_date", "2026-02-30")).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(session.fillControl("offer_date", "next Tuesday")).toMatchObject({
      ok: true,
      controls: [{ value: "next Tuesday", empty: false }],
    });
    expect(session.fillControl("remote", "yes")).toMatchObject({ ok: false, code: "invalid" });
    expect(session.fillControl("remote", "true")).toMatchObject({ ok: true });
    expect(session.fillControl("salary", true)).toMatchObject({ ok: false, code: "invalid" });
    expect(session.fillControl(5 as never, "x")).toMatchObject({ ok: false, code: "invalid" });
    expect(session.fillControl("salary", 5 as never)).toMatchObject({ code: "invalid" });

    expect((await open("01-mutual-nda")).fillControl("x", "y")).toMatchObject({
      code: "unknown-control",
      message: "The document has no content controls.",
    });
  });

  it("refuses a locked control", async () => {
    const { document } = await corpus("03-offer-letter-template");
    const id = Object.keys(document.controls ?? {}).find(
      (key) => document.controls?.[key]?.tag === "salary",
    ) as string;
    const locked = {
      ...document,
      controls: {
        ...document.controls,
        [id]: { ...document.controls?.[id], lock: "sdtContentLocked" as const },
      },
    };
    const session = openSession(locked as typeof document, { author: "Agent" });
    expect(session.controls().find((c) => c.name === "salary")?.readOnly).toBe(true);
    expect(session.fillControl("salary", "1")).toMatchObject({ ok: false, code: "read-only" });
  });
});

describe("what the review of #142 found", () => {
  /** The template with its controls' properties changed. */
  const patched = async (
    change: (control: Record<string, unknown>, tag: string) => Record<string, unknown>,
  ) => {
    const { document } = await corpus("03-offer-letter-template");
    const controls = Object.fromEntries(
      Object.entries(document.controls ?? {}).map(([id, control]) => [
        id,
        change({ ...control }, control.tag ?? ""),
      ]),
    );
    return openSession({ ...document, controls } as unknown as typeof document, {
      author: "Agent",
    });
  };

  it("fills one control by its id when a name would fill another, or several", async () => {
    // "Salary" is one control's title and another's tag.
    const session = await patched((control, tag) => {
      if (tag === "salary") {
        const { tag: _tag, ...untagged } = control;
        return untagged;
      }
      if (tag === "benefits") return { ...control, tag: "salary" };
      return control;
    });
    const [untagged, tagged] = session.controls().filter((c) => /salary/i.test(c.name));
    expect(untagged).toMatchObject({ name: "Salary", kind: "text" });
    expect(tagged).toMatchObject({ name: "salary", kind: "richText" });
    // By name the tag wins; by id each is filled alone.
    expect(session.fillControl("Salary", "by name")).toMatchObject({
      controls: [{ id: tagged?.id }],
    });
    expect(session.fillControl(untagged?.id as string, "by id")).toMatchObject({
      ok: true,
      controls: [{ id: untagged?.id, value: "by id" }],
    });
    expect(session.controls().map((c) => c.value)).toEqual(
      expect.arrayContaining(["by name", "by id"]),
    );
  });

  it("says which controls of a shared tag were not filled, each reading the value its own way", async () => {
    const shared = await patched((control, tag) =>
      ["position", "salary", "remote"].includes(tag) ? { ...control, tag: "x" } : control,
    );
    const text = shared.fillControl("x", "Hello");
    expect(text).toMatchObject({ ok: true, controls: [{}, { value: "Hello" }, {}] });
    expect(text.ok && text.unfilled.map((u) => u.code)).toEqual(["invalid", "invalid"]);
    expect(text.ok && text.text).toContain("Not filled:");
    expect(text.ok && text.text).toContain("drop-down list");
    // "true" checks the box and is text to the text control, whichever comes first.
    const mixed = shared.fillControl("x", "true");
    expect(mixed.ok && mixed.controls.map((c) => c.value)).toEqual([null, "true", true]);
    expect(mixed.ok && mixed.unfilled).toHaveLength(1);
  });

  it("does not list, or fill, a control in a block deleted as a tracked change", async () => {
    const session = openSession((await corpus("03-offer-letter-template")).document, {
      author: "Agent",
    });
    const salary = session.controls().find((c) => c.name === "salary");
    expect(session.deleteBlock(salary?.block as string)).toMatchObject({ ok: true });
    expect(session.controls().map((c) => c.name)).not.toContain("salary");
    expect(session.fillControl("salary", "5")).toMatchObject({ code: "unknown-control" });
    expect(session.block(salary?.block as string)).toMatchObject({ code: "gone" });
  });

  it("records nothing when a control has the value already", async () => {
    const session = openSession((await corpus("03-offer-letter-template")).document, {
      author: "Agent",
    });
    expect(session.fillControl("remote", false)).toMatchObject({ ok: true, unfilled: [] });
    expect(session.fillControl("salary", null)).toMatchObject({ ok: true });
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
  });

  it("names the merge fields without data once, whatever the capitals of the data", async () => {
    const session = openSession((await corpus("03-offer-letter-template")).document, {
      author: "Agent",
    });
    const result = session.updateFields({ data: { candidatefirstname: "Ada" } });
    expect(result).toMatchObject({ ok: true, updated: 1 });
    const said = result.ok ? result.text : "";
    expect(said).toContain("Merge fields without data: StartDate.");
    expect(said).not.toContain("CandidateFirstName");
    expect(said.match(/StartDate/g)).toHaveLength(1);
    expect(session.updateFields({ data: [] as never })).toMatchObject({ code: "invalid" });
    expect(session.updateFields({ data: { StartDate: { a: 1 } as never } })).toMatchObject({
      code: "invalid",
    });
    expect(session.updateFields(null as never)).toMatchObject({ ok: true });
  });

  it("says in words that page numbers need a layout", async () => {
    const session = openSession((await corpus("04-board-report")).document, { author: "Agent" });
    const result = session.updateFields();
    expect(result.ok && result.text).toMatch(
      /\d+ page numbers left: they need a page layout the session does not have\./,
    );
    expect(result.ok && result.text).not.toContain("no-layout");
  });
});

describe("updateFields", () => {
  it("fills merge fields from data, as tracked changes", async () => {
    const session = await open();
    const original = lines(session);
    expect(original[2]).toBe("[b3] Normal: Dear «CandidateFirstName»,");
    const result = session.updateFields({
      data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" },
    });
    expect(result).toMatchObject({ ok: true, updated: 2 });
    const now = lines(session);
    expect(now[2]).toBe("[b3] Normal, changed: Dear Ada,");
    expect(now[6]).toBe("[b7] Normal, changed: Start date: 5 January 2027");
    session.editor.run(rejectAllChanges("Agent"));
    expect(lines(session)).toEqual(original);
  });

  it("says what it left as it was", async () => {
    const session = await open();
    const result = session.updateFields();
    expect(result.ok && result.updated).toBe(0);
    expect(result.ok && result.text).toContain(
      "Merge fields without data: CandidateFirstName, StartDate.",
    );
    expect(lines(session)[2]).toBe("[b3] Normal: Dear «CandidateFirstName»,");
  });
});
