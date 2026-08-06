# Nuxt 3 Minimal Starter

Look at the [Nuxt 3 documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install the dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm run dev

# yarn
yarn dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm run build

# yarn
yarn build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm run preview

# yarn
yarn preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Note on h3 versions

Nuxt 3 runs on Nitro 2, which uses **h3 v1**. Because the workspace symlinks
`h3-compression` to the repo root, it resolves `h3` from the root's devDependency —
so build the playground with h3 v1 installed at the root, otherwise Nitro and
`h3-compression` end up with two different h3 majors in the same bundle:

```bash
pnpm add -D h3@^1.8.0 --ignore-scripts   # in the repo root
pnpm build                                # rebuild dist/
cd playground && pnpm nuxt:prepare && pnpm build
```

This only affects the workspace. A real install resolves `h3` from the consuming app.
