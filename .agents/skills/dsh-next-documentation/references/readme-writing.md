# README writing: research and examples

Reviewed on 2026-09-29. These sources inform the repository's
[README rules](<../../../../docs/AGENTS.md#package-readmes>); they are not a
claim that one template works for every project.

## What the guidance says

- **Answer the first questions.** [GitHub's README guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
  lists purpose, usefulness, getting started, help, and contributors. It recommends
  keeping longer documentation elsewhere. For our plugins, the README should
  get a Harness user to one useful result, not document every internal option.
- **Make the page easy to scan and act on.** [Google's style highlights](https://developers.google.com/style/highlights)
  recommend active voice, second person, conditions before instructions,
  sentence-case headings, numbered sequences, bulleted non-sequences,
  descriptive links, and image alt text. We retain the repository convention of
  inline-code UI labels rather than Google's bold styling.
- **Separate doing from understanding.** [Diátaxis: start here](https://diataxis.fr/start-here/)
  distinguishes tutorials, how-to guides, reference, and explanation. Its warning
  about overloading practical instruction with background applies directly to
  our READMEs. Put configuration reference and implementation detail in linked
  guides; retain warnings needed to take the first steps safely.

## Strong examples and what to borrow

These are useful examples, not a ranking or templates to copy wholesale.

| Example | Useful pattern | What not to copy for our plugins |
| --- | --- | --- |
| [slugify](https://github.com/sindresorhus/slugify#readme) | A short purpose statement, one install command, then concrete input/output examples. | Its full API reference belongs in a linked guide for a GUI plugin. |
| [GitHub CLI](https://github.com/cli/cli#readme) | A clear description and screenshot, with usage delegated to a manual and installation grouped by need. | A plugin does not need every platform's CLI installation instructions or binary-verification reference. |
| [bat](https://github.com/sharkdp/bat#readme) | Features illustrated with screenshots and small examples that show the result. | Its long platform and customization catalog would overwhelm our first-run pages. |

## Editorial decisions for this repository

The roughly 200–400-word target, 3–5 quick-start steps, short feature lists,
and one or two screenshots are local defaults, not numerical requirements
from the sources. They encourage focus without turning readability into a
word-count contest. A smaller utility should be shorter; a risky workflow may
need more explanation.

Use progressive detail: the README provides the safe first task, a linked guide
covers subsequent tasks, and reference documents describe exact configuration
or contracts. Never trade away a prerequisite, unreleased notice, cost warning,
or data-loss warning to make a page look cleaner.

## Reader check

Give a fresh reader only the README and ask:

1. What does this plugin help you do, and is it relevant to you?
2. Can you install it now? What do you need first?
3. Where do you open it, and what should happen after the quick start?
4. Could your files change, data leave your machine, or money be spent?
5. What important limitation or default might surprise you?
6. Where would you go for more detail or help?

A good answer must be supported by the page, not guessed from product knowledge.
Fix ambiguous labels, unexplained terms, and missing steps before recording
translation parity. Passing a Markdown/hash check is not a readability review.
