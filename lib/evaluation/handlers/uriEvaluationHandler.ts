import { Descriptor, InputDescriptorV1 } from '@sphereon/pex-models';
import { ICredential, ICredentialSchema, WrappedVerifiableCredential } from '@sphereon/ssi-types';
import jp from 'jsonpath';
import { nanoid } from 'nanoid';

import { Status } from '../../ConstraintUtils';
import { PEVersion } from '../../types';
import { IInternalPresentationDefinition, InternalPresentationDefinitionV1 } from '../../types';
import PexMessages from '../../types/Messages';
import { HandlerCheckResult } from '../core';
import { EvaluationClient } from '../evaluationClient';

import { AbstractEvaluationHandler } from './abstractEvaluationHandler';

export class UriEvaluationHandler extends AbstractEvaluationHandler {
  static matchAll = require('string.prototype.matchall');

  constructor(client: EvaluationClient) {
    super(client);
  }

  public getName(): string {
    return 'UriEvaluation';
  }

  private static HASHLINK_URL_ENCODED_REGEX = /hl:[a-zA-Z0-9]+:[a-zA-Z0-9]+/g;
  private static HASHLINK_QUERY_URL_REGEX =
    /https*?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)(hl=[a-zA-Z0-9]+)/g;

  //TODO: handle context objects
  //TODO: handle hashlinks
  public handle(d: IInternalPresentationDefinition, wrappedVcs: WrappedVerifiableCredential[]): void {
    // This filter is removed in V2
    (<InternalPresentationDefinitionV1>d).input_descriptors.forEach((inDesc: InputDescriptorV1, i: number) => {
      const uris: string[] = d.getVersion() !== PEVersion.v2 ? inDesc.schema.map((so) => so.uri) : [];
      wrappedVcs.forEach((wvc: WrappedVerifiableCredential, j: number) => {
        const vcUris: string[] = UriEvaluationHandler.buildVcContextAndSchemaUris(wvc.credential);
        this.evaluateUris(wvc, vcUris, uris, i, j, d.getVersion());
      });
    });
    const descriptorMap: Descriptor[] = this.getResults()
      .filter((e) => e.status === Status.INFO)
      .map((e) => {
        const inputDescriptor: InputDescriptorV1 = jp.nodes(d, e.input_descriptor_path)[0].value;
        return {
          id: inputDescriptor.id,
          format: 'ldp_vc',
          path: e.verifiable_credential_path,
        };
      });
    this.presentationSubmission = {
      id: nanoid(),
      definition_id: d.id,
      descriptor_map: descriptorMap,
    };
  }

  private evaluateUris(
    wvc: WrappedVerifiableCredential,
    verifiableCredentialUris: string[],
    inputDescriptorsUris: string[],
    idIdx: number,
    vcIdx: number,
    pdVersion: PEVersion
  ): void {
    let hasAnyMatch = false;
    if (pdVersion === PEVersion.v1) {
      for (let i = 0; i < inputDescriptorsUris.length; i++) {
        if (UriEvaluationHandler.containsHashlink(inputDescriptorsUris[i])) {
          this.getResults().push(this.createWarnResultObject(idIdx, vcIdx));
        }
      }
      for (let i = 0; i < verifiableCredentialUris.length; i++) {
        if (inputDescriptorsUris.find((el) => el === verifiableCredentialUris[i]) != undefined) {
          hasAnyMatch = true;
        }
      }
    } else {
      hasAnyMatch = true;
    }
    if (hasAnyMatch) {
      this.getResults().push(this.createSuccessResultObject(wvc, inputDescriptorsUris, idIdx, vcIdx));
    } else {
      this.getResults().push(this.createErrorResultObject(wvc, inputDescriptorsUris, idIdx, vcIdx));
    }
  }

  private static buildVcContextAndSchemaUris(credential: ICredential) {
    const uris: string[] = [];
    if (Array.isArray(credential['@context'])) {
      credential['@context'].forEach((value) => uris.push(value as string));
    } else {
      uris.push(<string>credential['@context']);
    }
    if (Array.isArray(credential.credentialSchema) && (credential.credentialSchema as ICredentialSchema[]).length > 0) {
      (credential.credentialSchema as ICredentialSchema[]).forEach((element) => uris.push(element.id));
    } else if (credential.credentialSchema) {
      uris.push((credential.credentialSchema as ICredentialSchema).id);
    }
    // review: JWT VC Presentation Profile uses `cred.type` as `cred.credentialSchema`
    // https://identity.foundation/jwt-vc-presentation-profile/#out-of-scope
    if (Array.isArray(credential.type)) {
      credential.type.forEach((element) => uris.push(element));
    } else if (credential.type) {
      uris.push(credential.type);
    }
    return uris;
  }

  private createSuccessResultObject(
    wvc: WrappedVerifiableCredential,
    inputDescriptorsUris: string[],
    idIdx: number,
    vcIdx: number
  ) {
    const result: HandlerCheckResult = this.createResult(idIdx, vcIdx);
    result.status = Status.INFO;
    result.message = PexMessages.URI_EVALUATION_PASSED;
    result.payload = {
      vcContext: wvc.credential['@context'],
      vcCredentialSchema: wvc.credential.credentialSchema,
      inputDescriptorsUris,
    };
    return result;
  }

  private createErrorResultObject(
    wvc: WrappedVerifiableCredential,
    inputDescriptorsUris: string[],
    idIdx: number,
    vcIdx: number
  ) {
    const result = this.createResult(idIdx, vcIdx);
    result.status = Status.ERROR;
    result.message = PexMessages.URI_EVALUATION_DIDNT_PASS;
    result.payload = {
      vcContext: wvc.credential['@context'],
      vcCredentialSchema: wvc.credential.credentialSchema,
      inputDescriptorsUris,
    };
    return result;
  }

  private createWarnResultObject(idIdx: number, vcIdx: number) {
    const result = this.createResult(idIdx, vcIdx);
    result.status = Status.WARN;
    result.message = PexMessages.URI_EVALUATION_DIDNT_PASS;
    result.payload = PexMessages.INPUT_DESCRIPTOR_CONTEXT_CONTAINS_HASHLINK_VERIFICATION_NOT_SUPPORTED;
    return result;
  }

  private createResult(idIdx: number, vcIdx: number): HandlerCheckResult {
    return {
      input_descriptor_path: `$.input_descriptors[${idIdx}]`,
      verifiable_credential_path: `$[${vcIdx}]`,
      evaluator: this.getName(),
      status: Status.INFO,
      message: undefined,
    } as HandlerCheckResult;
  }

  private static containsHashlink(url: string): boolean {
    return !(
      this.matchAll(url, UriEvaluationHandler.HASHLINK_QUERY_URL_REGEX).next().done &&
      this.matchAll(url, UriEvaluationHandler.HASHLINK_URL_ENCODED_REGEX).next().done
    );
  }
}
