import express from 'express';
import {
  createChatGroup,
  getUserChatGroups,
  getChatGroupDetails,
  addMembersToGroup,
  getChatMessages,
  deleteChatGroup
} from '../controllers/chatController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route   POST /api/chat/groups
 * @desc    Create a new chat group (Admin only)
 * @access  Private (Admin)
 */
router.post('/groups', authenticateToken, createChatGroup);

/**
 * @route   GET /api/chat/groups
 * @desc    Get all chat groups for current user
 * @access  Private
 */
router.get('/groups', authenticateToken, getUserChatGroups);

/**
 * @route   GET /api/chat/groups/:groupId
 * @desc    Get chat group details with members
 * @access  Private
 */
router.get('/groups/:groupId', authenticateToken, getChatGroupDetails);

/**
 * @route   POST /api/chat/groups/:groupId/members
 * @desc    Add members to existing chat group (Admin only)
 * @access  Private (Admin)
 */
router.post('/groups/:groupId/members', authenticateToken, addMembersToGroup);

/**
 * @route   GET /api/chat/groups/:groupId/messages
 * @desc    Get messages for a chat group
 * @access  Private
 */
router.get('/groups/:groupId/messages', authenticateToken, getChatMessages);

/**
 * @route   DELETE /api/chat/groups/:groupId
 * @desc    Delete a chat group (Admin only)
 * @access  Private (Admin)
 */
router.delete('/groups/:groupId', authenticateToken, deleteChatGroup);

export default router;
