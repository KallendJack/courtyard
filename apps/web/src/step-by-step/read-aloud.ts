/**
 * Reading words aloud in the browser's own voice (the Web Speech API's speech synthesis), for step
 * by step (#241). Chrome on Android uses the phone's own text-to-speech; nothing reaches Courtyard.
 */

/**
 * Reads `words` aloud in British English, in place of anything being read, and tells `ended` once
 * it has finished, or couldn't (a browser with no voice ends at once). Returns what stops it,
 * after which `ended` isn't told.
 */
export const readAloud = (words: string, ended: () => void): (() => void) => {
  if (!("speechSynthesis" in window)) {
    ended();
    return () => {};
  }
  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    ended();
  };
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.lang = "en-GB";
  utterance.onend = end;
  utterance.onerror = end;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  return () => {
    if (over) return;
    over = true;
    speechSynthesis.cancel();
  };
};
