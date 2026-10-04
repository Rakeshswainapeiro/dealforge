import React, { useState } from "react";
import { api } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Users, Shield, Building2, Plus, X, AlertCircle, CheckCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function UserManagement() {
  const [selectedUser, setSelectedUser] = useState(null);
  const [newGroup, setNewGroup] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => api.auth.me(),
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.entities.User.list(),
    initialData: [],
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }) => api.entities.User.update(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      setSelectedUser(null);
    },
  });

  const isAdmin = currentUser?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              <strong>Access Denied:</strong> This page is only accessible to administrators.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const allGroups = [...new Set(users.flatMap(u => u.groups || []))];

  const handleUpdateUser = (userId, updates) => {
    updateUserMutation.mutate({ userId, data: updates });
  };

  const handleAddGroup = (userId, group) => {
    const user = users.find(u => u.id === userId);
    const currentGroups = user.groups || [];
    if (!currentGroups.includes(group)) {
      handleUpdateUser(userId, { groups: [...currentGroups, group] });
    }
  };

  const handleRemoveGroup = (userId, group) => {
    const user = users.find(u => u.id === userId);
    const currentGroups = user.groups || [];
    handleUpdateUser(userId, { groups: currentGroups.filter(g => g !== group) });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-600 mt-1">Manage users, roles, and group assignments</p>
        </div>

        <Alert className="border-blue-200 bg-blue-50">
          <Shield className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <strong>Access Control:</strong> Assign users to groups to share companies and scenarios across your organization.
          </AlertDescription>
        </Alert>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-teal-600" />
                  All Users
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {isLoading ? (
                  <p className="text-slate-500">Loading users...</p>
                ) : (
                  <div className="space-y-3">
                    {users.map((user) => (
                      <Card key={user.id} className="border-slate-200">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center">
                                  <Users className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <h3 className="font-semibold text-slate-900">{user.full_name}</h3>
                                  <p className="text-sm text-slate-600">{user.email}</p>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 mb-3">
                                <Badge className={user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-800'}>
                                  {user.role}
                                </Badge>
                                {user.organization && (
                                  <Badge variant="outline" className="gap-1">
                                    <Building2 className="w-3 h-3" />
                                    {user.organization}
                                  </Badge>
                                )}
                                {user.department && (
                                  <Badge variant="outline">{user.department}</Badge>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-slate-600">Groups:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {(user.groups || []).map((group, idx) => (
                                      <Badge key={idx} className="bg-teal-100 text-teal-800 gap-1">
                                        {group}
                                        <button
                                          onClick={() => handleRemoveGroup(user.id, group)}
                                          className="ml-1 hover:bg-teal-200 rounded-full"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </Badge>
                                    ))}
                                    {(!user.groups || user.groups.length === 0) && (
                                      <span className="text-sm text-slate-400">No groups assigned</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" onClick={() => setEditingUser(user)}>
                                  Edit
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Edit User: {user.full_name}</DialogTitle>
                                  <DialogDescription>
                                    Update user organization, department, and group assignments
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="org">Organization</Label>
                                    <Input
                                      id="org"
                                      value={editingUser?.organization || user.organization || ""}
                                      onChange={(e) => setEditingUser({ ...user, organization: e.target.value })}
                                      placeholder="e.g., Investment Bank Corp"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="dept">Department</Label>
                                    <Input
                                      id="dept"
                                      value={editingUser?.department || user.department || ""}
                                      onChange={(e) => setEditingUser({ ...user, department: e.target.value })}
                                      placeholder="e.g., M&A Advisory"
                                    />
                                  </div>

                                  <Separator />

                                  <div className="space-y-2">
                                    <Label>Add to Group</Label>
                                    <div className="flex gap-2">
                                      <Select onValueChange={(value) => handleAddGroup(user.id, value)}>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select or create group" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {allGroups.map((group, idx) => (
                                            <SelectItem key={idx} value={group}>
                                              {group}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex gap-2 mt-2">
                                      <Input
                                        placeholder="Or create new group"
                                        value={newGroup}
                                        onChange={(e) => setNewGroup(e.target.value)}
                                      />
                                      <Button
                                        onClick={() => {
                                          if (newGroup.trim()) {
                                            handleAddGroup(user.id, newGroup.trim());
                                            setNewGroup("");
                                          }
                                        }}
                                        size="sm"
                                      >
                                        <Plus className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>

                                  <div className="flex justify-end gap-2 pt-4">
                                    <Button
                                      onClick={() => {
                                        if (editingUser) {
                                          handleUpdateUser(user.id, {
                                            organization: editingUser.organization,
                                            department: editingUser.department,
                                          });
                                        }
                                      }}
                                      className="bg-teal-600 hover:bg-teal-700"
                                    >
                                      Save Changes
                                    </Button>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-teal-600" />
                  Groups Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {allGroups.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-8">
                      No groups created yet. Add users to groups to enable collaboration.
                    </p>
                  ) : (
                    allGroups.map((group, idx) => {
                      const groupUsers = users.filter(u => u.groups?.includes(group));
                      return (
                        <div key={idx} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <h4 className="font-semibold text-slate-900 mb-2">{group}</h4>
                          <p className="text-sm text-slate-600 mb-3">
                            {groupUsers.length} member{groupUsers.length !== 1 ? 's' : ''}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {groupUsers.map((user, uidx) => (
                              <Badge key={uidx} variant="outline" className="text-xs">
                                {user.full_name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm mt-6">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-sm">Access Control Rules</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5" />
                    <p className="text-slate-700">
                      <strong>Private:</strong> Only the creator can access
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5" />
                    <p className="text-slate-700">
                      <strong>Organization:</strong> All users in same organization
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5" />
                    <p className="text-slate-700">
                      <strong>Group:</strong> Only assigned group members
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}