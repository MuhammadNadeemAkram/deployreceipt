const steps = [
  {
    title: "Test with a purpose",
    text: "Run website checks and capture evidence for the release you’re preparing.",
  },
  {
    title: "Review with context",
    text: "Bring findings, issues, and supporting evidence into a shared release report.",
  },
  {
    title: "Approve with clarity",
    text: "Give clients a clear place to review the report and record their release decision.",
  },
];
export function Workflow() {
  return (
    <section
      id="workflow"
      className="container workflow"
      aria-labelledby="workflow-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE PLANNED WORKFLOW</p>
          <h2 id="workflow-title">
            From a website check
            <br />
            to a shared decision.
          </h2>
        </div>
        <p>
          Less scattered feedback.
          <br />
          More context for every release.
        </p>
      </div>
      <ol className="workflow-grid">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="number">0{i + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
