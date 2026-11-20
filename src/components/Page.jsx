import { useId } from 'react';

export default function Page({ title, description, className = '', children }) {
  const titleId = useId();
  return <section className={`app-page${className ? ' ' + className : ''}`} aria-labelledby={titleId}>
    <header className="app-page-heading">
      <h1 id={titleId}>{title}</h1>
      {description && <p className="page-description">{description}</p>}
    </header>
    {children}
  </section>;
}
