# EU-Tort-3 — Hackathon Game Jam

A 2-hour game jam where small groups build a game using a stack that was deliberately chosen *for* you: **Phaser 4 + TypeScript + Vite**.

You are not expected to know Phaser. You are not expected to know Node. You are not expected to walk away knowing them either. The point is to experiment with what's possible when you collaborate with **Claude** without your usual constraints — no backend, no pipelines, no Jira — and see how far you can push it in two hours.

At T+2hr we demo by screen-share. Show whatever you built.

## How it works

1. **Fork** this repo on GitHub. Your group works in your fork.
2. **Clone** your fork locally.
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:8080. Edits hot-reload.
4. Run `claude` in the repo. `CLAUDE.md` and the Phaser skill pack under `.claude/skills/` load automatically — Claude already knows the project layout, the asset paths, and how Phaser 4 works.
5. Build. Push to your fork.
6. At T+2hr — screen-share demo.

## The game

**EU-Tort-3** — "Europe (Tortoise)", an AWS region that isn't on the status page. Tower defence: AWS services are the towers, tortoise-themed intruders are the infrastructure attacks, and the origin server at the end of the path is what you're defending.

There is no art in the repo yet. Placeholder shapes are generated at runtime in `Preloader.create()` (see `sparkle`), so nothing blocks on assets. Drop real files into `public/assets/` and load them in `Preloader.preload()` when they exist.

Starting scenes: a start page (`MainMenu`), a stub gameplay scene (`Game`), and an end screen (`GameOver`).

## Groups

### Group 1

| Name | Email |
|------|-------|
| Gabor | gabor@primer.io |
| Danny Caulwell | danny.caulwell@primer.io |
| Adem Sabic | adem.sabic@primer.io |
| Paul Sebastian | paul.sebastian@primer.io |
| Achim Munene | achim.munene@primer.io |

### Group 2

| Name | Email |
|------|-------|
| Darius | darius@primer.io |
| Boris | boris@primer.io |
| Tai Lucas | tai.lucas@primer.io |
| Francisco | francisco@primer.io |
| Dimitris | dimitris@primer.io |

### Group 3

| Name | Email |
|------|-------|
| Euler | euler@primer.io |
| Zsofia Sinko | zsofia.sinko@primer.io |
| HJ | hj@primer.io |
| Salma | salma@primer.io |
| Onur Var | onur.var@primer.io |

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Install dependencies (once) |
| `npm run dev` | Dev server on http://localhost:8080 with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | Surface TypeScript errors Vite hides in dev |

Everything else (project layout, how to load assets, where scenes live, house rules) lives in [`CLAUDE.md`](./CLAUDE.md) — or just ask Claude.

## Credits

Built on top of the official [Phaser 4 Vite TS template](https://github.com/phaserjs/template-vite-ts). Phaser is © Phaser Studio Inc.
