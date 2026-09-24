import {
  defineNode,
  FieldComposer,
  isRecord,
  NodeOutput,
  readFields,
  type FieldDefinition,
  type NodeHandler,
  type NodeInvocation,
  type ParameterReader,
} from '@runflux/runtime';

export interface SetParameters {
  readonly fields: readonly FieldDefinition[];
  readonly includeOtherFields: boolean;
}

/** Composes an object from the configured fields, optionally on top of the input object's fields. */
export class SetNode implements NodeHandler<SetParameters> {
  constructor(private readonly composer = new FieldComposer()) {}

  execute({ parameters, input }: NodeInvocation<SetParameters>): NodeOutput {
    const base = parameters.includeOtherFields && isRecord(input) ? input : {};
    return NodeOutput.main(this.composer.compose(parameters.fields, base));
  }
}

/** Field rows, or the `{ name: value }` object the editor's map view stores. */
function readSetFields(parameters: ParameterReader): FieldDefinition[] {
  const fields = parameters.raw('fields');
  if (isRecord(fields)) return Object.entries(fields).map(([name, value]) => ({ name, value }));
  return readFields(parameters, 'fields');
}

export default defineNode<SetParameters>({
  parseParameters: (parameters) => ({
    fields: readSetFields(parameters),
    includeOtherFields: parameters.boolean('includeOtherFields', false),
  }),
  createHandler: () => new SetNode(),
});
