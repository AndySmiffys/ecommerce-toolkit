import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    // This page is outside the Shopify admin, so there is no AppProvider and no Polaris: plain HTML only.
    <main style={{ maxWidth: 420, margin: "10vh auto", padding: 16, fontFamily: "Inter, system-ui, sans-serif" }}>
      <Form method="post" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Log in</h1>
        <label style={{ display: "grid", gap: 4 }}>
          Shop domain
          <input name="shop" type="text" value={shop} onChange={(e) => setShop(e.currentTarget.value)} autoComplete="on" placeholder="example.myshopify.com" aria-invalid={Boolean(errors.shop)} aria-describedby={errors.shop ? "shop-error" : undefined} style={{ padding: 8, fontSize: 16 }} />
        </label>
        {errors.shop && <span id="shop-error" role="alert" style={{ color: "#b42318" }}>{errors.shop}</span>}
        <button type="submit" style={{ padding: "8px 16px", fontSize: 16, cursor: "pointer" }}>Log in</button>
      </Form>
    </main>
  );
}
