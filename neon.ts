// Neon services for this project: Postgres (implicit), Neon Auth and one private Object Storage bucket.
// A plain object (what @neon/config's defineConfig returns), so the CLI needs no npm package at the repo root.
export default {
  auth: true,
  buckets: {
    assets: { access: "private" },
  },
};
