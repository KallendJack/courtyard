/** What went wrong with something the owner just did, said plainly. Nothing when there's no message. */
export function FormError(props: { message: string | undefined; id?: string }) {
  if (!props.message) return null;
  return (
    <p role="alert" id={props.id} className="text-sm font-normal text-destructive-text">
      {props.message}
    </p>
  );
}
