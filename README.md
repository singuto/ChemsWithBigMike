# Chems with big mike

A local Starlight chemistry workflow helper. It expands guidebook recipes into a single Chem Master dump (CMD) plus Mix in Master (MIM) steps, using the same category layout as Licks-the-Vials’ guide.

## Run

Node 18.19 or newer is required. Vite is pinned to 6 so it runs on the system Node (18.19); Vite 8 needs Node 20.19 or 22.12.

```bash
npm install
npm run dev
```

Open the printed localhost URL. In a browser tab, categories, equipment, sources, and the selected category stay in `localStorage`.

A desktop window keeps the same data in `~/.config/Chems with big mike/kobold.json`. The first launch copies `~/.config/Chemistry for Kobolds/kobold.json` into that folder when the new file is missing. The page loads that file before it writes, so opening the window cannot replace a save with an empty category list. A browser tab does not share this file.

```bash
npm run app
npm run package
```

`npm run app` builds the page and opens the window. `npm run package` writes an AppImage and a `Chems with big mike.desktop` launcher into `release/`. On Windows, `npm run package:win` writes an NSIS installer instead.

## Releases

GitHub Actions builds a Linux AppImage and a Windows NSIS installer when you push a version tag. The tag sets the package version (`v0.1.0` → `0.1.0`).

```bash
git tag v0.1.0
git push origin v0.1.0
```

Installers are attached to the GitHub Release for that tag.

## Data

Shipped in `public/`:

- `chem_recipes.json` / `starting_chems.json` — generated from the Starlight YAML clone
- `default_categories.json` — starting category seeds (editable in the app)
- `base_sources.json` — suggested ways to obtain water, blood, plasma, fuel, botany chems
