export default function HomePage(): React.JSX.Element {
  return (
    <>
      <h1>Victoria Seadragons</h1>
      <p className="app-lead">
        Plataforma del club de rugby subacuático. Esta es la cáscara inicial: el resto de las
        funcionalidades llega epic por epic, cada una con sus tickets y su revisión.
      </p>
      <section className="card" aria-labelledby="estado-titulo">
        <h2 id="estado-titulo">Estado del servicio</h2>
        <p>La API versionada responde en el endpoint de salud, que consulta la base de datos.</p>
        <a href="/api/v1/health">GET /api/v1/health</a>
      </section>
    </>
  );
}
