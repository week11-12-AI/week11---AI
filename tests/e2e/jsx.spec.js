import { test, expect } from "@playwright/test";

test("JSX produces VDOM and real DOM with navigation between both phases", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Phase 2 · JSX와 VDOM →" }).click();
  await expect(page).toHaveURL(/\/phase2.html$/);
  await expect(page.locator("#jsx-result h3.title")).toHaveText("할 일 목록");
  const vnode = JSON.parse(await page.locator("#jsx-vdom").textContent());
  expect(vnode.attributes).toEqual({ class: "title" });
  expect(vnode.children).toEqual([{ type: "text", value: "할 일 목록" }]);
  await page.getByRole("link", { name: "← Phase 1 DOM 실험실" }).click();
  await expect(page.locator("#editor [data-key='title']")).toHaveText("오늘의 샘플");
  expect(errors).toEqual([]);
});
