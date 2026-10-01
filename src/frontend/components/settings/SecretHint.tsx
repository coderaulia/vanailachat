/** Saved keys come back masked (`••••abcd`); say so, so an unchanged field is not mistaken for a lost key. */
export function SecretHint({ value }: { value?: string }) {
  if (!value?.startsWith('••••')) return null;
  const tail = value.slice(4);
  return (
    <p className="settings-hint settings-secret-hint">
      🔒 A key{tail ? ` ending in ${tail}` : ''} is saved and hidden. Type a new one to replace it, or clear the field to remove it.
    </p>
  );
}
