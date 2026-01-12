import { supabaseAdmin } from '../config/supabase.js';
import { successResponse, errorResponse, validationError } from '../utils/responses.js';

/**
 * Create a new chat group
 * POST /api/chat/groups
 */
export const createChatGroup = async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    const userId = req.user.id;

    // Validation
    if (!name) {
      return validationError(res, { field: 'Chat group name is required' });
    }

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return validationError(res, { field: 'At least one member must be added' });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return errorResponse(res, 'Only admins can create chat groups', 403);
    }

    // Verify all member IDs exist
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .in('id', memberIds);

    if (usersError || !users || users.length !== memberIds.length) {
      return errorResponse(res, 'One or more user IDs are invalid', 400);
    }

    // Create chat group
    const { data: chatGroup, error: groupError } = await supabaseAdmin
      .from('chat_groups')
      .insert([{
        name,
        created_by: userId,
        is_active: true
      }])
      .select()
      .single();

    if (groupError) {
      console.error('Error creating chat group:', groupError);
      return errorResponse(res, 'Failed to create chat group', 500);
    }

    // Add admin as a member
    const members = [
      {
        chat_group_id: chatGroup.id,
        user_id: userId,
        is_admin: true
      },
      // Add other members
      ...memberIds.map(memberId => ({
        chat_group_id: chatGroup.id,
        user_id: memberId,
        is_admin: false
      }))
    ];

    const { error: membersError } = await supabaseAdmin
      .from('chat_members')
      .insert(members);

    if (membersError) {
      console.error('Error adding members:', membersError);
      // Rollback: delete the chat group
      await supabaseAdmin.from('chat_groups').delete().eq('id', chatGroup.id);
      return errorResponse(res, 'Failed to add members to chat group', 500);
    }

    // Fetch complete group data with members
    const { data: completeGroup } = await supabaseAdmin
      .from('chat_groups')
      .select(`
        *,
        chat_members (
          user_id,
          is_admin,
          joined_at,
          users (
            id,
            email,
            full_name,
            profile_picture
          )
        )
      `)
      .eq('id', chatGroup.id)
      .single();

    return successResponse(res, completeGroup, 'Chat group created successfully');
  } catch (error) {
    console.error('Error in createChatGroup:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};

/**
 * Get all chat groups for current user
 * GET /api/chat/groups
 */
export const getUserChatGroups = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all groups where user is a member
    const { data: chatGroups, error } = await supabaseAdmin
      .from('chat_groups')
      .select(`
        *,
        chat_members!inner (
          user_id,
          is_admin,
          joined_at
        ),
        created_by_user:users!chat_groups_created_by_fkey (
          id,
          email,
          full_name,
          profile_picture
        )
      `)
      .eq('chat_members.user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching chat groups:', error);
      return errorResponse(res, 'Failed to fetch chat groups', 500);
    }

    // For each group, get member count and last message
    const groupsWithDetails = await Promise.all(
      chatGroups.map(async (group) => {
        // Get member count
        const { count: memberCount } = await supabaseAdmin
          .from('chat_members')
          .select('*', { count: 'exact', head: true })
          .eq('chat_group_id', group.id);

        // Get last message
        const { data: lastMessage } = await supabaseAdmin
          .from('chat_messages')
          .select('message, created_at, sender_id, users (full_name)')
          .eq('chat_group_id', group.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        return {
          ...group,
          member_count: memberCount || 0,
          last_message: lastMessage || null
        };
      })
    );

    return successResponse(res, groupsWithDetails, 'Chat groups fetched successfully');
  } catch (error) {
    console.error('Error in getUserChatGroups:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};

/**
 * Get chat group details with members
 * GET /api/chat/groups/:groupId
 */
export const getChatGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is member of this group
    const { data: membership } = await supabaseAdmin
      .from('chat_members')
      .select('*')
      .eq('chat_group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return errorResponse(res, 'You are not a member of this chat group', 403);
    }

    // Get group details with all members
    const { data: chatGroup, error } = await supabaseAdmin
      .from('chat_groups')
      .select(`
        *,
        chat_members (
          user_id,
          is_admin,
          joined_at,
          users (
            id,
            email,
            full_name,
            profile_picture,
            role
          )
        ),
        created_by_user:users!chat_groups_created_by_fkey (
          id,
          email,
          full_name,
          profile_picture
        )
      `)
      .eq('id', groupId)
      .single();

    if (error || !chatGroup) {
      console.error('Error fetching chat group:', error);
      return errorResponse(res, 'Chat group not found', 404);
    }

    return successResponse(res, chatGroup, 'Chat group details fetched successfully');
  } catch (error) {
    console.error('Error in getChatGroupDetails:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};

/**
 * Add members to existing chat group
 * POST /api/chat/groups/:groupId/members
 */
export const addMembersToGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberIds } = req.body;
    const userId = req.user.id;

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return validationError(res, { field: 'At least one member ID is required' });
    }

    // Check if user is admin of this group
    const { data: chatGroup } = await supabaseAdmin
      .from('chat_groups')
      .select('created_by')
      .eq('id', groupId)
      .single();

    if (!chatGroup || chatGroup.created_by !== userId) {
      return errorResponse(res, 'Only the group creator can add members', 403);
    }

    // Verify all member IDs exist
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .in('id', memberIds);

    if (usersError || !users || users.length !== memberIds.length) {
      return errorResponse(res, 'One or more user IDs are invalid', 400);
    }

    // Check for existing members
    const { data: existingMembers } = await supabaseAdmin
      .from('chat_members')
      .select('user_id')
      .eq('chat_group_id', groupId)
      .in('user_id', memberIds);

    const existingMemberIds = new Set(existingMembers?.map(m => m.user_id) || []);
    const newMemberIds = memberIds.filter(id => !existingMemberIds.has(id));

    if (newMemberIds.length === 0) {
      return errorResponse(res, 'All users are already members of this group', 400);
    }

    // Add new members
    const members = newMemberIds.map(memberId => ({
      chat_group_id: groupId,
      user_id: memberId,
      is_admin: false
    }));

    const { error: insertError } = await supabaseAdmin
      .from('chat_members')
      .insert(members);

    if (insertError) {
      console.error('Error adding members:', insertError);
      return errorResponse(res, 'Failed to add members', 500);
    }

    return successResponse(res, { added_count: newMemberIds.length }, 'Members added successfully');
  } catch (error) {
    console.error('Error in addMembersToGroup:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};

/**
 * Get messages for a chat group
 * GET /api/chat/groups/:groupId/messages
 */
export const getChatMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    // Check if user is member of this group
    const { data: membership } = await supabaseAdmin
      .from('chat_members')
      .select('*')
      .eq('chat_group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return errorResponse(res, 'You are not a member of this chat group', 403);
    }

    // Build query
    let query = supabaseAdmin
      .from('chat_messages')
      .select(`
        *,
        sender:users!chat_messages_sender_id_fkey (
          id,
          email,
          full_name,
          profile_picture
        )
      `)
      .eq('chat_group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Add pagination
    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching messages:', error);
      return errorResponse(res, 'Failed to fetch messages', 500);
    }

    return successResponse(res, messages.reverse(), 'Messages fetched successfully');
  } catch (error) {
    console.error('Error in getChatMessages:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};

/**
 * Delete a chat group (admin only)
 * DELETE /api/chat/groups/:groupId
 */
export const deleteChatGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.id;

    // Check if user is the creator
    const { data: chatGroup } = await supabaseAdmin
      .from('chat_groups')
      .select('created_by')
      .eq('id', groupId)
      .single();

    if (!chatGroup || chatGroup.created_by !== userId) {
      return errorResponse(res, 'Only the group creator can delete this group', 403);
    }

    // Soft delete by setting is_active to false
    const { error } = await supabaseAdmin
      .from('chat_groups')
      .update({ is_active: false })
      .eq('id', groupId);

    if (error) {
      console.error('Error deleting chat group:', error);
      return errorResponse(res, 'Failed to delete chat group', 500);
    }

    return successResponse(res, null, 'Chat group deleted successfully');
  } catch (error) {
    console.error('Error in deleteChatGroup:', error);
    return errorResponse(res, 'Internal server error', 500);
  }
};
