# Asset Ledger

| file | dimensions | intended channel | color space | repeat / texel density | canonical consumer |
| --- | ---: | --- | --- | --- | --- |
| `aged-walnut-frame.webp` | 1024x1024 | authored albedo/color variation | `SRGBColorSpace` | repeat by real-distance UVs, 4 texels/world unit in the semantic writer fixture | `examples/semantic-mesh-writer/` top material slot |
| `antique-gold-frame.webp` | 1024x1024 | authored albedo/metal finish color | `SRGBColorSpace` | repeat by real-distance UVs, 4 texels/world unit | `examples/semantic-mesh-writer/` top material slot |
| `dark-ebony-frame.webp` | 1024x1024 | authored albedo/color variation | `SRGBColorSpace` | repeat by real-distance UVs, 4 texels/world unit | `examples/semantic-mesh-writer/` top material slot |
| `gallery-mat-board.webp` | 768x768 | authored mat-board color | `SRGBColorSpace` | not a geometry data map; sample as color | gallery/mat material consumers |

Geometry data, normals, roughness, masks, ids, and generated lookup fields stay
`NoColorSpace`; these four WebP assets are author-facing color inputs.
