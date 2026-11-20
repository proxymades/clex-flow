import Page from '../components/Page.jsx';
import ComponentCatalog from '../catalog/ComponentCatalog.jsx';

export default function Library({ catalog }) {
  return <Page className="library-page" title="Библиотека компонентов" description="Компоненты, блоки логики и платы для ваших проектов.">
    <ComponentCatalog catalog={catalog} />
  </Page>;
}
