package com.tutien.pixel.services;

import com.tutien.pixel.entities.usersEntity;
import com.tutien.pixel.repositories.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class UsersService {
    @Autowired
    private UserRepository repo;

    public List<usersEntity> findAll() {
        return repo.findAll();
    }

    public Optional<usersEntity> findById(int id) {
        return repo.findById(id);
    }

    public usersEntity create(usersEntity user) {
        return repo.save(user);
    }

    public usersEntity update(int id, usersEntity u) {
        usersEntity x = repo.findById(id).orElseThrow();
        x.setUsername(u.getUsername());
        x.setPassword(u.getPassword());
        x.setLastLogin(u.getLastLogin());
        x.setCreateDate(u.getCreateDate());
        x.setCccd(u.getCccd());
        x.setEmail(u.getEmail());
        return repo.save(x);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}
