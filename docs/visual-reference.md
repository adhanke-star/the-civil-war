# Visual reference: what UG:G looks like up close (the §1b bar, measured)

Observed 2026-10-02 from the 19 Steam store screenshots (1920x1080) and 23 images on ultimategeneral.com,
zoomed 2x with `tools/ref-crops.mjs`. The images are copyrighted and stay local (`.out/reference/`; crop
sheets in `.out/reference/crops/`); only these written notes are committed. UG:G's camera never gets much
closer than its store shots, so this is the detail a player actually sees.

## Scale at the default battle zoom (1080p)
- A soldier is **13-17 px tall**. A brigade of 1,000-2,500 men shows roughly 150-300 figures.
- A barn is about 4-5 soldiers tall. Trees are about 1.5-2.5 soldiers tall. A gun wheel is about 0.7 soldier tall.
- Detail comes from **silhouette, contrast and painted texture at that size**, not triangle count. Our camera
  can zoom much closer (min distance 120 m), so our figures must also survive close zoom, or that zoom must be limited.

## Infantry
- **Silhouette:** legs clearly apart mid-stride (an A shape), arms visible, a kepi with brim and top, a pack or
  blanket-roll hump, and the musket as a thin dark line. Marching: musket slanted over the shoulder. Firing:
  musket level. Charging: musket forward and low.
- **Uniform:** two tones with strong contrast. Union: dark navy coat, sky-blue trousers. Confederate: grey or
  butternut coat with lighter grey or brown trousers, varied man to man. Light faces and hands.
- **Shading:** lit top, darker side, a crisp edge against the grass (each man reads as a painted miniature).
- **Poses seen:** marching, standing to fire (with smoke at the muzzle), running or charging, fallen. Officers
  ride horses. Each man is slightly out of step with his neighbours.
- **Formations:** a line is **two dense ranks, shoulder to shoulder** (the gap is less than one figure width).
  Skirmishers spread 2-4 figure widths apart in front. A charge or rout becomes a loose running swarm. Long
  moves go in **column along roads**.
- **State shown at the feet:** a selected unit has a **green elliptical halo under each man**; a unit under
  fire has a **red halo under each man**. The bodies themselves are not tinted.
- **Casualties:** bodies with limbs splayed (trousers visible) pile up densely where a unit fought; dead
  horses lie where cavalry fought.

## Artillery
- Dark carriage and barrel on **two large spoked wheels** that read clearly, with the trail on the ground.
  Four to six guns per battery, two to three gun lengths apart, each with 4-5 crew standing around it.
- **Limbers with horse teams** wait behind, or lead the guns at a trot in column when the battery moves.
- Firing: a muzzle flash and a large drifting smoke cloud.

## Buildings and farms
- Large and painted: a red barn with white trim, window frames, doors; a white or grey two-storey house with
  a porch and red-brick chimneys; grey or brown roofs with shingle shading; outbuildings; fenced yards.

## Vegetation
- **Woods:** open stands of individual trees with grass between them, not a solid carpet. Round deciduous
  trees in varied greens with several lumpy lobes, a lit top and a shadowed underside, mixed with layered
  conifers (stacked cones, dark blue-green).
- **Orchards:** neat grids of small round trees on lighter green parcels. Lone and hedgerow trees along
  fields and roads.

## Ground
- Dark olive grass with a brushed, directional stroke texture. Fields are irregular polygons with soft
  edges. Wheat is bright yellow with strokes. Crops show rows.
- Roads: orange-tan with dark edges and ruts. Streams: dark blue water, a lighter edge highlight, brown
  earth banks, meandering. Fences: straight post-and-rail (three rails) and zig-zag worm fences; low grey
  stone walls. Grey boulders at rocky places.
- Place names: big serif letters, **extruded in 3D** so they stand up off the ground with a drop shadow.

## Light and colour
- Dark, slightly desaturated greens and olives; a cool violet-blue cast that deepens into heavy dark corners;
  warm highlights; tilt-shift blur at the top and bottom edges. Smoke is soft grey-white, low and drifting.

## Movement (from stills; the trailers were not studied)
- Lines advance and stay straight; turning is a wheel (the inner end slows). Long marches go in column on
  roads and deploy into line. A charge breaks into a sprint. A rout scatters. Skirmishers screen ahead.

## Gap list for this repo (M1 build 3e2896c)
- Figures are ~90-triangle merged boxes: no stride silhouette, no kepi brim or pack, no musket line at
  battle zoom. Aaron: "block blobs".
- Formation: four loose ranks (DECISIONS 0009). UG:G uses **two dense ranks** plus a skirmish screen.
- No column on roads, no per-man state halos (bodies are tinted instead), no officer riders.
- Guns are a cylinder, a box and two discs: no spokes. Limbers have box horses. No crew poses or recoil.
- Buildings are flat-coloured boxes without painted windows. Trees are one lumpy sphere type plus simple cones.
- Labels are painted flat, not extruded.
