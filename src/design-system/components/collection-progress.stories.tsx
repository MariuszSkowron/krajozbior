import type { Meta, StoryObj } from "@storybook/react-vite";

import styles from "../foundation/foundation.module.css";
import { CollectionProgress } from "./collection-progress";

const meta = { title: "Krajozbiór Components/CollectionProgress" } satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const States: Story = {
  name: "Stany: w toku, ukończona, pusta",
  render: () => (
    <main className={styles.page}>
      <h1>CollectionProgress</h1>
      <div style={{ display: "grid", gap: "var(--space-lg)", maxWidth: "24rem" }}>
        <CollectionProgress visited={9} total={24} label="Postęp w kolekcji Wieże ciśnień" />
        <CollectionProgress visited={24} total={24} label="Postęp w kolekcji Zamki" />
        <CollectionProgress visited={0} total={0} label="Postęp w kolekcji Nowa" />
      </div>
    </main>
  ),
};
