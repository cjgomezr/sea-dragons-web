export function SectionPlaceholder({
  title,
}: {
  title: string;
}): React.JSX.Element {
  return (
    <>
      <h1>{title}</h1>
      <p className="app-lead">Esta sección está en construcción.</p>
    </>
  );
}
