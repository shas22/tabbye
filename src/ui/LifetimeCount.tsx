import { Icon } from './components';

const explanation =
  "Tabs Tabbye closed automatically in this browser. Deleting links doesn't lower it, and imported links aren't counted.";

export function LifetimeCount({ count }: { count: number }) {
  return (
    <section
      className="lifetime-stat"
      aria-label="Lifetime tabs archived"
      aria-describedby="lifetime-help"
      title={explanation}
    >
      <div className="lifetime-total">
        <span className="lifetime-mark">
          <Icon name="archive" />
        </span>
        <strong>{count.toLocaleString()}</strong>
        <span>{count === 1 ? 'tab archived' : 'tabs archived'}</span>
      </div>
      <p className="lifetime-scope">
        All time <span aria-hidden="true">·</span> this browser
      </p>
      <p className="sr-only" id="lifetime-help">
        {explanation}
      </p>
    </section>
  );
}
