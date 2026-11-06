import { expect, test } from "@playwright/test";
import { FIXTURES, openFixture, pageBreaks } from "./fixtures.js";

// Snapshots are per engine and platform (`<name>-<project>-<platform>`): text rendering differs
// between them. Update after an intended layout change with `--update-snapshots`, then review
// the PNG diffs.
for (const fixture of FIXTURES) {
  test(`fixture "${fixture.name}": same page breaks on every run, same pixels`, async ({
    page,
  }) => {
    await openFixture(page, fixture);
    const breaks = await pageBreaks(page);
    // A fresh load lays the document out the same way.
    await openFixture(page, fixture);
    expect(await pageBreaks(page)).toEqual(breaks);
    expect(`${JSON.stringify(breaks, null, 2)}\n`).toMatchSnapshot(`${fixture.name}-breaks.json`);
    await expect(page.getByRole("textbox", { name: "Document" })).toHaveScreenshot(
      `${fixture.name}.png`,
    );
  });
}
