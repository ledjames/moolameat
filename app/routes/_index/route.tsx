import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Moola Meat tracking</h1>
        <p className={styles.text}>
          Custom app for SF Express outbound status on yhnbqk-zz.myshopify.com.
          It does not change inventory, prices, or the theme.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>yhnbqk-zz.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>3.16 status query</strong>. The usable path for outbound
            status. Live SF calls stay off until you explicitly enable them.
          </li>
          <li>
            <strong>3.15 push receiver</strong>. A stub only. It is not a
            callback URL for SF Express.
          </li>
          <li>
            <strong>Shopify tracking</strong>. Waybill numbers attach to an
            existing fulfillment. This app does not create fulfillments.
          </li>
        </ul>
      </div>
    </div>
  );
}
