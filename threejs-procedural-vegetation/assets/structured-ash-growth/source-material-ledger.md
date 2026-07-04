# Structured Ash Growth Source Material Ledger

This ledger records the local asset provenance available in this repository.

| File | Format | Dimensions | Local source claim | Color-space policy | SHA-256 |
| --- | --- | ---: | --- | --- | --- |
| `ash.png` | PNG indexed color | 1024 x 1024 | Retained from the reviewed tree demo under the repository MIT license | `SRGBColorSpace` for color, `NoColorSpace` when sampled as alpha/data | `5ec987db3829a839856c32c79b18a33a78f209e911cad55c65abfb77f30e2d29` |
| `bark-color.jpg` | JPEG RGB | 512 x 1024 | AmbientCG Bark001, CC0 1.0 public domain dedication | `SRGBColorSpace` | `2a7e8c742aa0110057d7a3ff0e8ec193c26ef23b77bc778fb9258c0e41b29474` |
| `bark-normal.jpg` | JPEG RGB | 512 x 1024 | AmbientCG Bark001, CC0 1.0 public domain dedication | `NoColorSpace` | `d7a275aa573a701d8814d7378abd8ea227f651ae6da33f8c57a6b862419e621e` |
| `bark-roughness.jpg` | JPEG grayscale | 512 x 1024 | AmbientCG Bark001, CC0 1.0 public domain dedication | `NoColorSpace` | `2c0829e7a04b78234357ac6eb93173667fab9191c4340343ce88dddfcca1e6fd` |

The Ash contract verifier depends on geometry and species counts, not on these
asset bytes. The scene example still records the color-space policy here so
material validation can catch color-as-data or data-as-color mistakes.
