import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** `/toolbar.html?tabs&es`: Word's tabs with the toolbar's `messages` in Spanish, in part (17.5). */
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formato" });

test.beforeEach(async ({ page }) => {
  await page.goto("/toolbar.html?tabs&es");
  await expect(toolbar(page)).toBeVisible();
});

test("shows the messages given, English for the others, without axe violations", async ({
  page,
}) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await expect(page.getByRole("tablist", { name: "Formato" }).getByRole("tab")).toHaveText([
    "Inicio",
    "Insertar",
    "Disposición",
    "Revisar",
    "Stamps",
  ]);
  const bold = toolbar(page).getByRole("button", { name: "Negrita" });
  await expect(bold).toHaveText("N");
  await expect(bold).toHaveAttribute("title", "Negrita");
  // Not given: English.
  await expect(toolbar(page).getByRole("button", { name: "Underline" })).toBeVisible();
  const scan = async () =>
    (
      await new AxeBuilder({ page }).include(".foli-ribbon").include(".foli-link-dialog").analyze()
    ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
  expect(await scan()).toEqual([]);

  // A dialog and its message, with the value filled in.
  await page.getByRole("tab", { name: "Insertar" }).click();
  await toolbar(page).getByRole("button", { name: "Tabla" }).click();
  await page.getByRole("menuitem", { name: "Insertar tabla…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insertar tabla" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Filas").fill("0");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Escribe un número de filas de 1 a 1000.");
  expect(await scan()).toEqual([]);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
});
