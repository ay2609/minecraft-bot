import type { ActionItem, CoreSkillName } from '../types';
import { executeAttackEntity } from './skills/attackEntity';
import { executeBreakBlock } from './skills/breakBlock';
import { executeCraftItem } from './skills/craftItem';
import { executeDropItem } from './skills/dropItem';
import { executeEquipItem } from './skills/equipItem';
import { executeFollowEntity } from './skills/followEntity';
import { executeInteractBlock } from './skills/interactBlock';
import { executeMoveTo } from './skills/moveTo';
import { executePlaceBlock } from './skills/placeBlock';
import { executeSendChat } from './skills/sendChat';
import { executeWait } from './skills/wait';
import type { ExecutorDependencies, SkillExecutionOutcome, SkillHandler } from './types';

export const requiredSkillNames: CoreSkillName[] = [
  'move_to',
  'follow_entity',
  'place_block',
  'break_block',
  'craft_item',
  'drop_item',
  'equip_item',
  'interact_block',
  'attack_entity',
  'send_chat',
];

function notImplemented(skill: CoreSkillName): SkillHandler {
  return (actionItem: ActionItem): Promise<SkillExecutionOutcome> => {
    void actionItem;
    return Promise.resolve({
      success: false,
      errorCode: 'invalid_state',
      errorMessage: `${skill} is not implemented yet`,
      stateChanges: {},
    });
  };
}

const registry: Record<CoreSkillName, SkillHandler> = {
  move_to: notImplemented('move_to'),
  follow_entity: notImplemented('follow_entity'),
  place_block: notImplemented('place_block'),
  break_block: notImplemented('break_block'),
  craft_item: notImplemented('craft_item'),
  drop_item: notImplemented('drop_item'),
  equip_item: notImplemented('equip_item'),
  interact_block: notImplemented('interact_block'),
  attack_entity: notImplemented('attack_entity'),
  send_chat: notImplemented('send_chat'),
};

export function resolveSkill(skill: string, dependencies: ExecutorDependencies = {}): SkillHandler | null {
  if (skill === 'WAIT') {
    return executeWait;
  }

  if (skill === 'move_to') {
    return (actionItem, context) => executeMoveTo(actionItem, context, dependencies);
  }

  if (skill === 'follow_entity') {
    return (actionItem, context) => executeFollowEntity(actionItem, context, dependencies);
  }

  if (skill === 'place_block') {
    return (actionItem, context) => executePlaceBlock(actionItem, context);
  }

  if (skill === 'break_block') {
    return (actionItem, context) => executeBreakBlock(actionItem, context);
  }

  if (skill === 'craft_item') {
    return (actionItem, context) => executeCraftItem(actionItem, context);
  }

  if (skill === 'drop_item') {
    return (actionItem, context) => executeDropItem(actionItem, context);
  }

  if (skill === 'equip_item') {
    return (actionItem, context) => executeEquipItem(actionItem, context);
  }

  if (skill === 'interact_block') {
    return (actionItem, context) => executeInteractBlock(actionItem, context);
  }

  if (skill === 'attack_entity') {
    return (actionItem, context) => executeAttackEntity(actionItem, context);
  }

  if (skill === 'send_chat') {
    return (actionItem, context) => executeSendChat(actionItem, context);
  }

  return registry[skill as CoreSkillName] ?? null;
}
