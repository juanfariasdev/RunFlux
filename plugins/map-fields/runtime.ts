import {
  defineNode,
  ExpressionError,
  ExpressionEvaluator,
  FieldComposer,
  isRecord,
  NodeOutput,
  readFields,
  type ExpressionScope,
  type FieldDefinition,
  type NodeContext,
  type NodeHandler,
  type NodeInvocation,
} from '@runflux/runtime';
import { ELEMENT_ERROR_POLICIES, MAP_MODES, type ElementErrorPolicy, type MapMode } from './parameters.js';

export interface MapFieldsParameters {
  readonly mode: MapMode;
  /** Field rows as configured: the manifest keeps their expressions verbatim for this node to resolve per element. */
  readonly fields: readonly FieldDefinition[];
  readonly includeOtherFields: boolean;
  /** The value mode's template, kept verbatim like the fields. */
  readonly value: unknown;
  readonly onElementError: ElementErrorPolicy;
}

/** What could not be mapped for one element: names the field, never the element's content. */
class ElementMappingError extends Error {
  constructor(readonly subject: string, readonly causeName: string) {
    super(`${subject} failed (${causeName})`);
    this.name = 'ElementMappingError';
  }
}

/**
 * Maps each element of a list input with its fields (one object per element) or its value (one value
 * per element). An input that is not a list is mapped as one element and keeps its shape. A failing
 * element fails the node, or is left out with a notice when `onElementError` is `skip`.
 */
export class MapFieldsNode implements NodeHandler<MapFieldsParameters> {
  // One evaluator per handler, reused for every element and execution, so each text compiles once.
  constructor(
    private readonly expressions = new ExpressionEvaluator(),
    private readonly composer = new FieldComposer(),
  ) {}

  execute({ parameters, input, context }: NodeInvocation<MapFieldsParameters>): NodeOutput {
    const elements: readonly unknown[] = Array.isArray(input) ? input : [input];
    const entries: unknown[] = [];
    const notices: string[] = [];
    elements.forEach((element, index) => {
      try {
        entries.push(this.map(parameters, element, context));
      } catch (error) {
        if (!(error instanceof ElementMappingError)) throw error;
        const position = index + 1;
        if (parameters.onElementError === 'fail') throw new Error(`map-fields: ${error.subject} failed for element ${position} (${error.causeName})`);
        notices.push(`${error.subject} skipped element ${position} (${error.causeName})`);
      }
    });
    const value = Array.isArray(input) ? entries : entries.length > 0 ? entries[0] : null;
    return NodeOutput.main(value, { notices });
  }

  private map(parameters: MapFieldsParameters, element: unknown, context: NodeContext): unknown {
    const scope: ExpressionScope = { $json: element, $node: context.nodes, $env: context.env };
    if (parameters.mode === 'value') return attempt('value', () => this.expressions.resolve(parameters.value, scope));
    const fields = parameters.fields.map((field) => ({
      name: field.name,
      value: attempt(`field "${field.name}"`, () => this.composer.normalize({ ...field, value: this.expressions.resolve(field.value, scope) })),
    }));
    return this.composer.compose(fields, parameters.includeOtherFields && isRecord(element) ? element : {});
  }
}

/** Runs one part of an element's mapping, keeping only the name of what went wrong. */
function attempt<TResult>(subject: string, work: () => TResult): TResult {
  try {
    return work();
  } catch (error) {
    // An expression's own error carries the real cause; its message may quote the element, so only the name is kept.
    const cause = error instanceof ExpressionError && error.cause instanceof Error ? error.cause : error;
    throw new ElementMappingError(subject, cause instanceof Error ? cause.name : 'Error');
  }
}

export default defineNode<MapFieldsParameters>({
  parseParameters: (parameters) => ({
    mode: parameters.choice('mode', MAP_MODES, 'fields'),
    fields: readFields(parameters, 'fields'),
    includeOtherFields: parameters.boolean('includeOtherFields', false),
    value: parameters.raw('value'),
    onElementError: parameters.choice('onElementError', ELEMENT_ERROR_POLICIES, 'fail'),
  }),
  createHandler: () => new MapFieldsNode(),
});
