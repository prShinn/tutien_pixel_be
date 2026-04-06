package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.playerEntity;
import com.tutien.pixel.entities.usersEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface PlayerRepository extends JpaRepository<playerEntity, Integer> {
    Optional<playerEntity> findById(int id);
    Optional<playerEntity> findByUserId(int userId);
}
