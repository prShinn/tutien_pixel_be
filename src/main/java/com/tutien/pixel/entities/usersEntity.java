package com.tutien.pixel.entities;

import jakarta.persistence.*;

import java.util.Date;

@Entity
@Table(name = "users")
public class usersEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(nullable = false, unique = true, length = 100)
    private String username;

    @Column(nullable = false, length = 150)
    private String password;

    @Column(length = 255)
    private String lastLogin;
    private Date createDate;
    private String cccd;
    private String email;
}
