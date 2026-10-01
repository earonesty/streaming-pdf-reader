# Regression fixtures

`atlantic-beach-page-150.pdf` is a one-page extract from a public Atlantic Beach, Florida agenda packet. It covers adjacent text spans whose embedded font metrics distinguish word boundaries from fragmented words.

SHA-256: `fa617172263e7c5cd1c1f363776afa2f83cdeff15dc33e774bff666cbebf736e`

`pompano-unsafe-structures-sept-2026.pdf` is a one-page public City of Pompano
Beach Unsafe Structures and Housing Appeals Board agenda. Its content stream
paints the item number, case number, owner, address, and inspector columns in
separate passes, exercising baseline grouping independently of source order.

SHA-256: `f5466c6db3fd49600c9a7eb6b621fa4c333b074907c067d223e169930f7df8a5`

`fonts09.pdf` is the unchanged one-page “Hello World!” sample attached by
Jochen Voss (`seehuhn`) to
[PDF Association Arlington issue #98](https://github.com/pdf-association/arlington-pdf-model/issues/98).
It embeds CID-keyed CFF outlines inside a `FontFile3 /Subtype /OpenType` stream
and uses custom `cidrange` Encoding CMaps. The regression verifies extraction,
Unicode glyph mapping (including curly quotes), and usable outline paths.

Source: https://github.com/pdf-association/arlington-pdf-model/files/12373677/fonts09.pdf

SHA-256: `2b9d25ac04654f672519d6e0d525fe10916ac557e111d30d6f356323239ea120`

The embedded Go font's BSD redistribution notice is in `GO-FONT-LICENSE.txt`.
This externally generated PDF is a test fixture, not package runtime content.
