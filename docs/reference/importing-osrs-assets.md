# Can current OSRS assets be imported into this rev 274 game?

**Question (Calum, 2026-10-16):** can assets from current Old School RuneScape (models, textures, animations, maps, items, NPCs, sounds) be imported into this 2004 game, or are the formats different?

**Based on:** Engine-TS `cd2f9e8c`, Client-TS `645fa04`, Content `53a8c10e4` (read, nothing run). OSRS side: RuneLite's cache loaders, `master` as fetched 2026-10-16 (commit hash not captured) from `https://raw.githubusercontent.com/runelite/runelite/master/cache/src/main/java/net/runelite/cache/definitions/loaders/` (`ModelLoader.java`, `FrameLoader.java`, `TextureLoader.java`). I did **not** read any OSRS cache; what follows about OSRS is only what those loaders show.

## Short answer

Not directly. Almost nothing is a file copy. Models are the closest: the 274 client reads exactly the layout RuneLite calls the "old format", so unchanged-since-2004 models could in principle be copied, but newer OSRS models use newer layouts the client cannot parse. Animations, textures, maps and configs all need converting, and some OSRS features have no equivalent in the 274 client at all. Anything needing a new client feature means editing `Client-TS`.

## What this repo does with assets (verified)

- Source assets are loose files in `Content/` (4556 `.ob2` models, 336 `.anim` sets, 50 textures as PNG, 483 `.jm2` maps, 914 `.synth`, 345 `.mid`; counted with `find`). Config is text in `Content/scripts/**/configs`.
- Pack tools in `Engine-TS/tools/pack/` build the client cache. Models are only gzip-compressed and written unchanged: `compressGz(data)` then `cache.write(1, id, packedData, 1)` (`Engine-TS/tools/pack/graphics/pack.ts:54-63`). So the `.ob2` bytes *are* the 274 client's model format.
- Ids are assigned by name in `Content/pack/*.pack` (e.g. `model.pack`, `npc.pack`); a new asset needs a name there.
- The client is hard-coded to 274 (`Client-TS/src/client/Client.ts:79`, `CLIENT_VERSION = 274`).

## Per asset type

| Asset | 274 format here | OSRS format (from RuneLite) | Verdict |
|---|---|---|---|
| Models | 18-byte trailer: vertex count, face count, textured-face count, flags, section sizes; faces carry a 16-bit colour, optional render type, priority, alpha, labels (`Client-TS/src/dash3d/Model.ts:138-216`) | RuneLite picks the decoder from the last two bytes: `-1,-3` type 3, `-1,-2` type 2, `-1,-1` type 1, otherwise `decodeOldFormat` (`ModelLoader.java:13-25`). `decodeOldFormat` reads the same 18-byte trailer (`ModelLoader.java:1123-1135`). Newer types use 23- and 26-byte trailers (`:422, :777, :46`) and per-face texture ids (`:309`) | Old-style models: same layout (inference from matching trailer fields; I did not test-load one). Newer models: need a converter, and texture ids and per-vertex features may not map. |
| Textures | 50 paletted 8-bit images in a Jagfile, `index.dat` plus `N.dat`; the client loops `i < 50` (`Pix3D.ts:91-96`, `Pix8.ts:26-40`); 50 entries in `Content/pack/texture.pack` | A texture definition points at sprite file ids with a fallback colour and animation direction/speed (`TextureLoader.java`) | Different system. Textures can be re-rendered to 128x128 paletted PNGs, but texture ids in new models would need remapping, and the 50-slot limit is hard-coded. Animated textures: no equivalent seen in the 274 loader. |
| Animations | Frames reference a skeleton ("base") that is embedded in the same file; trailer holds four section lengths (`Client-TS/src/dash3d/AnimFrame.ts:23-62`) | Frame refers to a separate framemap archive by index (`FrameLoader.java:36-44`) | Different layout, convertible in principle, but the skeleton (bone groups) must match the model's vertex labels, and OSRS models have different labelling. Needs per-model work. |
| Maps | Text `.jm2`: per-tile height, underlay, overlay, flags, plus LOC/NPC/OBJ lists; packed by `Engine-TS/tools/pack/map/Pack.js:31-130` | Not read | Not verified. Map squares reference loc and overlay ids, so imported terrain only works after the loc, model and overlay definitions exist under 274 ids. |
| Items, NPCs, locs | Text configs keyed by name, packed by `Engine-TS/tools/pack/config/*.ts`; the client decodes with a fixed opcode set | Not read | Not verified. Easy to re-express as text (name, model, size), hard part is the models and animations they reference. Behaviour is Lost City's own scripts, not cache data (`docs/history/project-origins.md`). |
| Sounds | `.synth` effects and `.mid` music (`Engine-TS/tools/pack/sound`, `midi`); the repo already swaps in MP3s client-side (`docs/design/custom-lair-music.md`) | Not read | Not verified. MP3/OGG replacement is the proven route here. |

## Practical consequences

- A wholly new OSRS monster needs: model(s) in 274 layout, animations rebuilt against 274 skeletons, textures remapped, config entries, and RuneScript behaviour. The Dagannoth Kings problem (project memory: no post-274 assets) is this.
- Cheapest wins, in order: (1) custom sounds/music (already works), (2) old-format models that exist in both games, (3) re-colouring existing models, (4) converted new models with textures dropped to flat colours, (5) animations.
- Licensing: assets are Jagex IP (`Content/README.md:12-13`); the repo only holds them for historical preservation. Importing current game assets is the user's call to weigh.

## Not checked

OSRS item/NPC/loc/map/sound formats; whether any OSRS model really decodes with `Model.ts` (no test load); texture size and palette constraints beyond what `Pix8.depack` reads; client-side limits on vertex/face counts; the ordering of per-face data in newer model types.

## Open questions

See `docs/open-questions.md` #146 and #147.
