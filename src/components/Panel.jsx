export default function Panel({ as: Element = 'section', className = '', highlight = false, children, ...props }) {
  return <Element className={`panel${highlight ? ' panel-highlight' : ''}${className ? ' ' + className : ''}`} {...props}>{children}</Element>;
}
