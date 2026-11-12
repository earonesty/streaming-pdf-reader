# Rich content smoke test

This paragraph wraps **mixed inline runs** as one line box, including _italic text_, regular text, and a **[linked run that can wrap](https://example.com/docs)**. The link annotation follows only the linked fragments.

Long tokens still hard-break inside the paragraph: **supercalifragilisticexpialidocious-supercalifragilisticexpialidocious**.

> _This inset note is visually grouped by a narrower measure, a changed typeface, and a containing panel. Semantic reflow should keep these lines together without guessing whether the block is a quotation, abstract, sidebar, or figure._

Normal body text resumes at the outer measure after the inset block.

**Plan comparison**

| Feature | Basic | Pro |
| --- | --- | --- |
| Inline text in a cell with **bold** and **[link](https://example.com)** | Yes | **Yes** |
| Priority review | No | **Included** |

_Footer cell spans all columns and keeps **mixed inline content** together._
