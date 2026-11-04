import { z } from 'zod'

/**
 * A product described as exact primitive parts, in metres. Claude writes this as structured
 * output; the builder turns it into a mesh. Kept flat (arrays, no tuples or optional fields)
 * so it maps cleanly onto structured-output JSON Schema.
 */

export const SHAPES = ['box', 'rounded_box', 'cylinder', 'sphere', 'capsule', 'torus', 'extrude', 'lathe'] as const

export const Material = z.object({
  id: z.string().describe('Short id referenced by parts, e.g. "frame"'),
  name: z.string().describe('Human name, e.g. "Black powder-coated steel"'),
  color: z.string().describe('Base colour as #rrggbb, as it would look under neutral light'),
  roughness: z.number().describe('0 = mirror, 1 = fully matte'),
  metalness: z.number().describe('0 for non-metals (plastic, wood, paint over metal reads ~0.2), 1 for bare metal'),
})

export const Part = z.object({
  name: z.string().describe('What this part is, e.g. "left leg column"'),
  shape: z.enum(SHAPES),
  dims: z
    .array(z.number())
    .describe(
      'Metres. box: [width, height, depth]. rounded_box: [width, height, depth, corner_radius]. cylinder: [radius_top, radius_bottom, height] (axis Y). ' +
        'sphere: [radius]. capsule: [radius, straight_length] (axis Y). torus: [ring_radius, tube_radius] (ring in the XY plane). ' +
        'extrude: [depth, bevel] (profile extruded along Z, centred). lathe: [] (profile revolved around Y).',
    ),
  profile: z
    .array(z.array(z.number()))
    .describe('extrude: closed polygon as [x, y] points in metres around the part origin. lathe: [radius, y] points. Empty [] for every other shape.'),
  position: z.array(z.number()).describe('[x, y, z] in metres: the centre of the part (extrude/lathe: the origin of the profile coordinates)'),
  rotation_deg: z.array(z.number()).describe('[x, y, z] Euler rotation in degrees, applied X then Y then Z'),
  material: z.string().describe('id of one of the materials'),
})

export const PartsSpec = z.object({
  name: z.string().describe('Short product name'),
  assumptions: z.array(z.string()).describe('Every size or detail you had to estimate or could not see, one per entry'),
  overall_size_m: z.array(z.number()).describe('[width X, height Y, depth Z] of the whole object in metres'),
  photo_view: z
    .object({
      azimuth_deg: z.number().describe('Horizontal camera angle of the Front photo: 0 = straight at the front, positive = camera moved to the right of the object'),
      elevation_deg: z.number().describe('Camera height angle: 0 = level, positive = looking down'),
    })
    .describe('Your estimate of where the camera was for the Front photo'),
  materials: z.array(Material),
  parts: z.array(Part),
})

export type PartsSpec = z.infer<typeof PartsSpec>
export type PartSpec = z.infer<typeof Part>

export const SYSTEM_PROMPT = `You are a precise product modeller. From reference photos you produce an exact model of the object as primitive parts, in metres, following the response schema.

Coordinate system
- Y is up; the floor is y = 0 and the object stands on it.
- The object is centred on X and Z at the origin.
- The Front photo shows the front, which faces +Z. X runs left to right as seen in that photo, so X is the width.

How to be accurate
- If the user gives real dimensions, the whole object's bounding box must match them exactly. Derive every part's size from them using the proportions in the photos.
- Without given dimensions, use standard real-world sizes for that kind of product (e.g. desk height 72-75 cm), and record each estimate in "assumptions".
- Measure proportions from the photos carefully: thickness of panels and tops, cross-sections of legs and beams (square vs round vs rectangular), the shape and length of feet, gaps, overhangs and offsets.
- Model only what the photos show. Don't add parts you can't see (e.g. a back panel or crossbar that isn't there). For sides the photos don't show, keep the geometry simple and consistent with what is visible, and say so in "assumptions".
- Use Detail photos for small parts (controls, buttons, handles, screws, logos). Buttons and markings can be small thin boxes or extrusions.
- Connected parts must touch or slightly overlap, with no floating gaps.
- Prefer a few correctly sized parts over many approximate ones. Use rounded_box for softened edges, extrude for flat custom outlines (logos, brackets, profiles), and lathe for round turned parts (knobs, bottles, feet pads).

Materials
- One material per real surface finish. Colour as seen under neutral light; realistic PBR values (powder-coated steel: roughness ~0.5, metalness ~0.2; laminate: roughness ~0.6, metalness 0; bare aluminium: roughness ~0.3, metalness 1).

Also estimate the Front photo's camera angle in "photo_view" so a render can match the photo.`

export const CHECK_PROMPT = `The last image is a render of your spec above, seen from your photo_view estimate. Compare it carefully with the reference photos: overall proportions, thicknesses, cross-sections (square vs round), part positions, missing or extra parts, and colours. Also re-check photo_view so the render lines up with the Front photo. Return the complete corrected spec. If it already matches, return it unchanged.`
