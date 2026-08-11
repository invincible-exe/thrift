/**
 * Wraps every SplitText word in its own overflow-hidden mask so words can
 * slide up out of the mask without spilling over the line. The pb/-mb keeps
 * descenders (p, g, y…) inside the mask on tight line-heights without
 * shifting the line layout.
 */
export function maskWords(words: Element[]) {
  words.forEach((word) => {
    const mask = document.createElement("span");
    mask.className =
      "inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]";
    word.parentNode?.insertBefore(mask, word);
    mask.appendChild(word);
  });
}
