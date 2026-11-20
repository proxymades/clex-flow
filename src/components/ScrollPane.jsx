export default function ScrollPane({ as: Element = 'aside', className = '', children, ...props }) {
  return <Element className={`scroll-pane${className ? ' ' + className : ''}`} {...props}>
    <div className="scroll-pane-content">{children}</div>
  </Element>;
}
