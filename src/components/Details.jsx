export default function Details({ title, className = '', children, ...props }) {
  return <details className={`ui-details${className ? ' ' + className : ''}`} {...props}>
    <summary>{title}</summary>
    {children}
  </details>;
}
