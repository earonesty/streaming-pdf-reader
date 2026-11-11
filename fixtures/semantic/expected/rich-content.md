# Rich content smoke test

This paragraph wraps **mixed inline runs** as one line box, including _italic text_, regular text, and a **[linked run that can wrap](https://example.com/docs)**. The link annotation follows only the linked fragments.

Long tokens still hard-break inside the paragraph: **supercalifragilisticexpialidocious-supercalifragilisticexpialidocious**.

> _This inset note is visually grouped by a narrower measure, a changed typeface, and a containing panel. Semantic reflow should keep these lines together without guessing whether the block is a quotation, abstract, sidebar, or figure._

Normal body text resumes at the outer measure after the inset block.

<table>
      <caption>Plan comparison</caption>
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">Basic</th>
          <th scope="col">Pro</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Inline text in a cell with <strong>bold</strong> and <strong><a href="https://example.com">link</a></strong></th>
          <td>Yes</td>
          <td><strong>Yes</strong></td>
        </tr>
        <tr>
          <th scope="row">Priority review</th>
          <td>No</td>
          <td><strong>Included</strong></td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Footer cell spans all columns and keeps <strong>mixed inline content</strong> together.</td>
        </tr>
      </tfoot>
    </table>
