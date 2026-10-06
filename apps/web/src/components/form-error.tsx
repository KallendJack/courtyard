/**
 * What went wrong, said plainly, where it happened: something the owner just did, or a part of the
 * page that couldn't load. Nothing when there's no message.
 */
export function FormError(props: { message: string | undefined; id?: string }) {
  if (!props.message) return null;
  return (
    <p role="alert" id={props.id} className="text-sm font-normal text-destructive-text">
      {props.message}
    </p>
  );
}
