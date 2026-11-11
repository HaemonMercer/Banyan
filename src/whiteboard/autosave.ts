/**
 * Autosave for card text, Google Docs-style: edits are written this long after typing pauses,
 * without waiting for the editor to close. Each write is recorded in the card's version history
 * (edits close together share one version). `[[ ]]` links are still made only when the editor
 * closes, so half-typed titles never create links.
 */
export const AUTOSAVE_MS = 1500;

/** Runs async jobs one after another, so a save never overtakes an earlier one. */
export function serial() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(job: () => Promise<T>): Promise<T> => {
        const next = tail.then(job);
        tail = next.catch(() => undefined);
        return next;
    };
}
